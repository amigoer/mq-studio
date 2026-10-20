import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ComponentProps, CSSProperties } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_HIGHLIGHT_LENGTH, tokenizeJson } from "@/lib/jsonTokens";
import { JSON_TOKEN_COLOR } from "./json-block";

/**
 * The metrics both layers are laid out with. They have to agree to the pixel:
 * the colours are a second copy of the text sitting behind a textarea whose
 * own text is transparent, so a font, a padding or a wrap that differs shows
 * up as colour sliding off the characters it belongs to.
 *
 * `pre-wrap` plus `break-word` is what a textarea wraps with, and the sizes
 * are the shell's code-block pair.
 */
const METRICS: CSSProperties = {
  margin: 0,
  border: "none",
  borderRadius: 0,
  padding: "12px 16px",
  fontSize: "11.5px",
  lineHeight: 1.8,
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "normal",
  tabSize: 2,
};

/**
 * A body editor that colours JSON as it is typed.
 *
 * There is no editable element that can colour its own text, so this is the
 * usual pair: a transparent textarea over a tokenised copy of the same string,
 * scrolled together. `language` decides only whether the copy is drawn - the
 * two modes share every metric, so switching between them moves nothing.
 *
 * The textarea is the one in flow, so the editor always has a height: `rows`
 * tall on its own, or whatever a caller gives it with `flex-1`. Only the copy
 * is laid over it. With both layers absolute the box had no height of its
 * own, and a caller that set none drew an editor zero pixels tall.
 */
export function CodeEditor({
  value,
  onValueChange,
  language = "text",
  rows = 8,
  framed = true,
  className,
  ...props
}: {
  value: string;
  onValueChange: (next: string) => void;
  language?: "json" | "text";
  /** The border and focus ring of an input. Off where the page frames the editor itself. */
  framed?: boolean;
} & Omit<ComponentProps<"textarea">, "value" | "onChange" | "style">) {
  const input = useRef<HTMLTextAreaElement>(null);
  const ghost = useRef<HTMLPreElement>(null);

  const tokens = useMemo(
    () =>
      language === "json" && value.length <= MAX_HIGHLIGHT_LENGTH ? tokenizeJson(value) : null,
    [language, value],
  );

  const follow = useCallback(() => {
    if (input.current == null || ghost.current == null) return;
    ghost.current.scrollTop = input.current.scrollTop;
    ghost.current.scrollLeft = input.current.scrollLeft;
  }, []);

  // Replacing the body - 格式化, a paste, a switch of format - moves the
  // textarea's scroll without ever firing a scroll event.
  useLayoutEffect(follow, [follow, tokens]);

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden",
        // On the box rather than the textarea, whose metrics the copy must match.
        framed &&
          "rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        className,
      )}
    >
      {tokens != null && (
        <pre
          ref={ghost}
          aria-hidden
          className="mono3 mqs-ghost pointer-events-none absolute inset-0 size-full text-(--c-fg-2)"
          style={METRICS}
        >
          {tokens.map((token, index) => (
            <span key={index} style={{ color: JSON_TOKEN_COLOR[token.kind] }}>
              {token.text}
            </span>
          ))}
          {/* A block drops its own trailing newline, a textarea keeps the empty
              line it opens. Without this the two run one line apart. */}
          {"\n"}
        </pre>
      )}
      <Textarea
        ref={input}
        spellCheck={false}
        {...props}
        rows={rows}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onScroll={follow}
        className={cn(
          // relative keeps it painted above the absolute copy, as before.
          "mono3 mqs-scroll relative min-h-0 flex-1 field-sizing-fixed resize-none",
          "border-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0",
          // Textarea eases its colour, and here that colour is the difference
          // between showing the text and showing the layer under it: switching
          // format would fade one out with nothing yet faded in.
          "transition-none",
        )}
        style={{
          ...METRICS,
          background: "transparent",
          color: tokens == null ? "var(--c-fg-2)" : "transparent",
          caretColor: "var(--c-fg)",
        }}
      />
    </div>
  );
}
