import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from "lucide-react";
import { openExternal } from "@/api/platform";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The subset of Markdown the release notes and the assistant's answers are
 * written in.
 *
 * Notes come from the GitHub release body, which `scripts/release-notes.mjs`
 * builds from CHANGELOG.zh-CN.md, and answers from a model told to keep to
 * plain Markdown. Headings, lists, emphasis, links, GitHub's alert blocks,
 * rules, fences and pipe tables are the whole of it. Anything else degrades to
 * a paragraph rather than showing its markers, which is the failure mode that
 * matters -- a reader must never be handed raw `**` and `](`.
 *
 * Two things are deliberate and load-bearing:
 *
 *   - No `dangerouslySetInnerHTML`, ever. This renders remote content, and the
 *     only safe parser is one that cannot emit HTML at all.
 *   - Links open in the system browser. The webview has no back button, so
 *     navigating it away from the app strands the user.
 */

const ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;

type AlertKind = (typeof ALERT_KINDS)[number];

type ListItem = { text: string; depth: number };

type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; alert: AlertKind | null; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { kind: "rule" };

const FENCE = /^\s*(?:```|~~~)/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\]\s*$/i;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const DELIMITER_CELL = /^:?-+:?$/;

/**
 * A table row's cells. A pipe inside inline code or escaped with a backslash
 * is part of its cell, which is how a model writes `a|b` in one.
 */
function cellsOf(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "`") code = !code;
    if (char === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** The alignments a delimiter row sets, or null when the line is not one. */
function delimiterOf(line: string, columns: number): Align[] | null {
  if (!line.includes("-")) return null;
  const cells = cellsOf(line);
  if (cells.length !== columns || !cells.every((cell) => DELIMITER_CELL.test(cell))) return null;
  return cells.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":")
      ? "center"
      : cell.endsWith(":")
        ? "right"
        : cell.startsWith(":")
          ? "left"
          : null,
  );
}

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

    // A row of pipes followed by a row of dashes with as many cells is a
    // table; anything less is a paragraph that happens to contain a pipe.
    if (line.includes("|")) {
      const header = cellsOf(line);
      const align = delimiterOf(at(index + 1), header.length);
      if (align != null) {
        flush();
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && at(index).trim() !== "" && at(index).includes("|")) {
          const cells = cellsOf(at(index));
          rows.push(header.map((_, column) => cells[column] ?? ""));
          index += 1;
        }
        index -= 1;
        blocks.push({ kind: "table", header, align, rows });
        continue;
      }
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

/* Release notes are read beside the app's own text; an answer is the text. */
const PARAGRAPH = {
  notes: "text-[13px] leading-[1.8] text-(--c-fg-2)",
  answer: "text-[13px] leading-[1.7] text-(--c-fg)",
};

const ALIGN_CLASS: Record<Exclude<Align, null>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** Renders Markdown. `source` is Markdown; the output is never HTML. */
export function Markdown({
  source,
  className,
  tone = "notes",
}: {
  source: string;
  className?: string;
  tone?: keyof typeof PARAGRAPH;
}) {
  const { t } = useTranslation();
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;
  const paragraphClass = PARAGRAPH[tone];

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
                <p className={paragraphClass}>{inline(block.text, key)}</p>
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
                    <span className={cn("min-w-0", paragraphClass)}>
                      {inline(item.text, `${key}-${position}`)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={key} className="mb-3 overflow-hidden rounded-lg border">
                <Table className="text-[12px]">
                  <TableHeader className="bg-(--c-bar)">
                    <TableRow className="hover:bg-transparent">
                      {block.header.map((cell, column) => (
                        <TableHead
                          key={column}
                          className={cn("h-7 px-2.5 whitespace-normal", ALIGN_CLASS[block.align[column] ?? "left"])}
                        >
                          {inline(cell, `${key}-h${column}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.rows.map((row, position) => (
                      <TableRow key={position} className="hover:bg-transparent">
                        {row.map((cell, column) => (
                          <TableCell
                            key={column}
                            className={cn(
                              "px-2.5 py-1.5 align-top whitespace-normal tabular-nums",
                              ALIGN_CLASS[block.align[column] ?? "left"],
                            )}
                          >
                            {inline(cell, `${key}-${position}-${column}`)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          default:
            return (
              <p key={key} className={cn("mb-3", paragraphClass)}>
                {inline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
