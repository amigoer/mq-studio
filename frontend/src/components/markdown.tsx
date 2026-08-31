import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from "lucide-react";
import { openExternal } from "@/api/platform";
import { cn } from "@/lib/utils";

/**
 * The subset of Markdown the release notes are written in.
 *
 * Notes come from the GitHub release body, which `scripts/release-notes.mjs`
 * builds from CHANGELOG.zh-CN.md -- so the syntax is bounded by what this
 * repository generates rather than by what Markdown allows. That is what makes
 * a renderer this small honest: headings, lists, emphasis, links, GitHub's
 * alert blocks, rules and fences are the whole of it. Anything else degrades to
 * a paragraph rather than showing its markers, which is the failure mode that
 * matters -- a reader must never be handed raw `**` and `](`.
 *
 * Two things are deliberate and load-bearing:
 *
 *   - No `dangerouslySetInnerHTML`, ever. This renders remote content, and the
 *     only safe parser is one that cannot emit HTML at all.
 *   - Links open in the system browser. The webview has no back button, so
 *     navigating it away from the app strands the user.
 *
 * Tables are the known gap. If notes ever start carrying them, replace the
 * innards of this file with react-markdown -- `Markdown` is the only export
 * anything imports, so nothing else has to move.
 */

const ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;

type AlertKind = (typeof ALERT_KINDS)[number];

type ListItem = { text: string; depth: number };

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; alert: AlertKind | null; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const FENCE = /^\s*(?:```|~~~)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\]\s*$/i;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * A soft line break between two CJK characters is a space in HTML, and a space
 * is not how Chinese is written -- the changelog wraps mid-sentence, so joining
 * naively puts a gap in the middle of every wrapped line. Latin text keeps its
 * space, because there it is the word boundary.
 */
const CJK = /[⺀-〿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;

/**
 * The character a reader will actually see at a join, which is not always the
 * one at the edge: a line ending in `**` closes emphasis, and comparing that
 * asterisk instead of the ideograph before it puts the space back in.
 */
const TRAILING_MARKERS = /[*_`~]+$/;
const LEADING_MARKERS = /^[*_`~]+/;

function joinLines(lines: string[]): string {
  return lines.reduce((joined, line) => {
    if (joined === "") return line;
    const tail = joined.replace(TRAILING_MARKERS, "").slice(-1);
    const head = line.replace(LEADING_MARKERS, "").slice(0, 1);
    const glue = CJK.test(tail) && CJK.test(head) ? "" : " ";
    return joined + glue + line;
  }, "");
}

/**
 * Splits the source into blocks. Line-driven rather than split on blank lines,
 * because a list item's wrapped continuation is an indented line with no marker
 * and has to be folded back into the item it belongs to -- which is the whole
 * reason the old renderer scattered every wrapped bullet into its own row.
 *
 * Exported for the test, which feeds it a real published release body.
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  // `noUncheckedIndexedAccess` is on, and every read here is bounded by the
  // loop anyway, so one accessor keeps the walk readable.
  const at = (index: number): string => lines[index] ?? "";
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: joinLines(paragraph) });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = at(index);

    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(at(index))) {
        body.push(at(index));
        index += 1;
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading != null) {
      flush();
      blocks.push({ kind: "heading", text: heading[2] ?? "" });
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length) {
        const inner = QUOTE.exec(at(index));
        if (inner == null) break;
        quoted.push(inner[1] ?? "");
        index += 1;
      }
      index -= 1;
      const marker = ALERT_MARKER.exec(quoted[0] ?? "");
      const alert = marker == null ? null : ((marker[1] ?? "").toLowerCase() as AlertKind);
      const body = alert == null ? quoted : quoted.slice(1);
      blocks.push({
        kind: "quote",
        alert,
        text: joinLines(body.filter((one) => one.trim() !== "")),
      });
      continue;
    }

    if (ITEM.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: ListItem[] = [];
      while (index < lines.length) {
        const next = ITEM.exec(at(index));
        if (next != null) {
          // Two spaces per level is what the changelog and GitHub both use.
          // One level is as deep as it goes: deeper nesting reads as noise in a
          // panel this narrow, so it flattens rather than marching rightwards.
          items.push({
            text: next[2] ?? "",
            depth: Math.min(1, Math.floor((next[1] ?? "").length / 2)),
          });
          index += 1;
          continue;
        }
        // An indented line with no marker continues the item above it.
        const last = items[items.length - 1];
        if (last == null || !/^\s+\S/.test(at(index))) break;
        last.text = joinLines([last.text, at(index).trim()]);
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/**
 * Only http(s) survives. Anything else -- `javascript:`, `data:`, a relative
 * path -- loses its link and renders as the text it wrapped.
 */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

/*
 * One pass, alternation ordered by precedence: code first so markers inside it
 * stay literal, then explicit links before bare URLs so a link's target is not
 * matched twice, then strong before emphasis so `**` is not read as two `*`.
 *
 * A bare URL stops at CJK: the changelog writes `见 https://x 的说明`, and a
 * greedy class would swallow the sentence that follows the link.
 */
const INLINE_SOURCE = [
  "(`+)([\\s\\S]+?)\\1",
  "\\[([^\\]]*)\\]\\(([^)\\s]+)[^)]*\\)",
  "(https?://[^\\s<>()\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef]+)",
  "\\*\\*([\\s\\S]+?)\\*\\*",
  "__([\\s\\S]+?)__",
  "\\*([^*\\n]+?)\\*",
  "_([^_\\n]+?)_",
].join("|");

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="cursor-pointer text-(--c-accent-blue) underline-offset-2 hover:underline"
      onClick={(event) => {
        event.preventDefault();
        void openExternal(href).catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <code className="mono3 rounded bg-(--c-bar) px-1.5 py-px text-[0.92em] text-(--c-fg)">
    {children}
  </code>
);

/**
 * Turns one run of text into nodes. Unmatched markers stay as they were typed.
 *
 * The scanner is built per call rather than shared: this recurses into the text
 * inside a link or an emphasis, and a `g` regex carries `lastIndex` across
 * calls, so one shared instance would have the inner scan resume the outer one.
 */
function inline(text: string, key: string): ReactNode[] {
  const scanner = new RegExp(INLINE_SOURCE, "g");
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) != null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const at = `${key}-${match.index}`;
    const [, , code, label, url, bare, strong, strongAlt, em, emAlt] = match;
    if (code != null) {
      nodes.push(<Code key={at}>{code}</Code>);
    } else if (url != null) {
      const href = safeHref(url);
      const text = label ?? "";
      nodes.push(
        href == null ? (
          text
        ) : (
          <Link key={at} href={href}>
            {inline(text, at)}
          </Link>
        ),
      );
    } else if (bare != null) {
      nodes.push(
        <Link key={at} href={bare}>
          {bare}
        </Link>,
      );
    } else if (strong != null || strongAlt != null) {
      nodes.push(
        <strong key={at} className="font-medium text-(--c-fg)">
          {inline(strong ?? strongAlt ?? "", at)}
        </strong>,
      );
    } else {
      nodes.push(<em key={at}>{inline(em ?? emAlt ?? "", at)}</em>);
    }
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Icon and colour per alert kind. Anything unrecognised is drawn as a plain quote. */
const ALERT_TONE: Record<AlertKind, { icon: typeof Info; wrap: string; label: string }> = {
  note: { icon: Info, wrap: "border-(--c-border) bg-(--c-bar)", label: "text-(--c-info-text)" },
  tip: { icon: Lightbulb, wrap: "border-(--c-border) bg-(--c-bar)", label: "text-(--c-ok-text)" },
  important: {
    icon: MessageSquareWarning,
    wrap: "border-(--c-warn-border) bg-(--c-warn-bg-soft)",
    label: "text-(--c-warn-text-deep)",
  },
  warning: {
    icon: TriangleAlert,
    wrap: "border-(--c-warn-border) bg-(--c-warn-bg-soft)",
    label: "text-(--c-warn-text-deep)",
  },
  caution: {
    icon: OctagonAlert,
    wrap: "border-(--c-err-border) bg-(--c-err-bg-soft)",
    label: "text-(--c-err-text)",
  },
};

const PARAGRAPH = "text-[13px] leading-[1.8] text-(--c-fg-2)";

/** Renders the release notes. `source` is Markdown; the output is never HTML. */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const { t } = useTranslation();
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;

  return (
    <div className={cn("min-w-0", className)}>
      {blocks.map((block, index) => {
        const key = String(index);
        const first = index === 0;
        switch (block.kind) {
          case "heading":
            // A `p` carrying the role, not an `h4`: the notes are dropped into
            // a dialog and a card whose own heading levels differ, and the
            // global type scale styles real headings for the boards.
            return (
              <p
                key={key}
                role="heading"
                aria-level={3}
                className={cn(
                  "mb-2 text-[13.5px] font-medium text-(--c-fg)",
                  first ? "mt-0" : "mt-5",
                )}
              >
                {inline(block.text, key)}
              </p>
            );
          case "rule":
            return <hr key={key} className="my-4 border-t border-(--c-border)" />;
          case "code":
            return (
              <pre
                key={key}
                className="mono3 mb-3 overflow-x-auto rounded-lg border border-(--c-border) bg-(--c-bar) p-2.5 text-[11.5px] leading-[1.7] text-(--c-fg-2)"
              >
                {block.text}
              </pre>
            );
          case "quote": {
            const alert = block.alert;
            const tone = alert == null ? null : ALERT_TONE[alert];
            const Icon = tone?.icon;
            return (
              <div
                key={key}
                className={cn(
                  "mb-3 rounded-lg border p-2.5",
                  tone?.wrap ?? "border-(--c-border) bg-(--c-bar)",
                )}
              >
                {alert != null && tone != null && Icon != null && (
                  <div className={cn("mb-1.5 flex items-center gap-1.5", tone.label)}>
                    <Icon size={14} aria-hidden />
                    <span className="text-[12px] font-medium">{t(`markdown.alert.${alert}`)}</span>
                  </div>
                )}
                <p className={PARAGRAPH}>{inline(block.text, key)}</p>
              </div>
            );
          }
          case "list":
            return (
              <ul key={key} className="mb-3">
                {block.items.map((item, position) => (
                  <li
                    key={position}
                    className={cn("mb-1.5 flex gap-[9px]", item.depth > 0 && "ml-4")}
                  >
                    <span className="flex-none text-[13px] leading-[1.8] text-(--c-muted-2)">
                      {block.ordered ? `${position + 1}.` : "·"}
                    </span>
                    <span className={cn("min-w-0", PARAGRAPH)}>
                      {inline(item.text, `${key}-${position}`)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={key} className={cn("mb-3", PARAGRAPH)}>
                {inline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
