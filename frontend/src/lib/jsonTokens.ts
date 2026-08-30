/** What one run of characters is, for colouring. */
export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punct" | "plain";

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

/**
 * Past this the colour is not worth what it costs to recompute on every
 * keystroke, and the editor falls back to plain text.
 */
export const MAX_HIGHLIGHT_LENGTH = 50_000;

/*
 * The body is being typed, so it is invalid JSON most of the time and a parser
 * is the wrong tool: it would give up at the first half-written value and
 * leave the rest uncoloured. This scans instead, one alternative at a time --
 * string, literal, bare word, number, punctuator -- and calls whatever it
 * stepped over plain.
 *
 * The string alternative stops at a newline so an unclosed quote colours its
 * own line rather than the rest of the document. The bare word comes before
 * the number so `a1` stays one plain word instead of splitting.
 */
const SCANNER =
  /"(?:[^"\\\n]|\\.)*"?|\b(?:true|false|null)\b|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;

const PUNCTUATORS = "{}[],:";

/** A string is a key when a colon follows it, which is the only place one can. */
function beforeColon(source: string, from: number): boolean {
  for (let index = from; index < source.length; index++) {
    const char = source[index] as string;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") continue;
    return char === ":";
  }
  return false;
}

function kindOf(text: string, source: string, after: number): JsonTokenKind {
  if (text.startsWith('"')) return beforeColon(source, after) ? "key" : "string";
  if (text === "true" || text === "false" || text === "null") return "literal";
  if (text.length === 1 && PUNCTUATORS.includes(text)) return "punct";
  return /^[-\d]/.test(text) ? "number" : "plain";
}

/**
 * Splits `source` into coloured runs.
 *
 * Every character of the input lands in exactly one token, in order: the
 * tokens are rendered behind a transparent textarea holding the same text, so
 * dropping or duplicating one shows up as text that does not line up.
 */
export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let plainFrom = 0;
  SCANNER.lastIndex = 0;
  for (let match = SCANNER.exec(source); match != null; match = SCANNER.exec(source)) {
    if (match.index > plainFrom) {
      tokens.push({ kind: "plain", text: source.slice(plainFrom, match.index) });
    }
    tokens.push({ kind: kindOf(match[0], source, SCANNER.lastIndex), text: match[0] });
    plainFrom = SCANNER.lastIndex;
  }
  if (plainFrom < source.length) tokens.push({ kind: "plain", text: source.slice(plainFrom) });
  return tokens;
}
