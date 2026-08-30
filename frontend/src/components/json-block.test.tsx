import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonText } from "./json-block";
import { MAX_HIGHLIGHT_LENGTH } from "@/lib/jsonTokens";

/** The rendered text, tags stripped and entities put back. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("JsonText", () => {
  const body = '{\n  "orderId": "ORD-88213",\n  "amount": 129,\n  "paid": true\n}';

  it("renders the document it was given, character for character", () => {
    expect(textOf(renderToStaticMarkup(<JsonText>{body}</JsonText>))).toBe(body);
  });

  it("colours values and leaves keys on the body colour", () => {
    const html = renderToStaticMarkup(<JsonText>{body}</JsonText>);
    expect(html).toContain('color:var(--c-ok-text)">&quot;ORD-88213&quot;');
    expect(html).toContain('color:var(--c-info-text)">129');
    expect(html).toContain('<span>&quot;orderId&quot;</span>');
  });

  /** A 4MB payload is a legal RocketMQ message; a span per token is not. */
  it("gives up on a body too large to tokenise", () => {
    const huge = `"${"x".repeat(MAX_HIGHLIGHT_LENGTH)}"`;
    expect(renderToStaticMarkup(<JsonText>{huge}</JsonText>)).not.toContain("<span");
  });
});
