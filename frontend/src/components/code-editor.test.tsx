import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeEditor } from "./code-editor";

const BODY = '{\n  "orderId": "ORD-TEST-001"\n}\n';

function render(language: "json" | "text"): string {
  return renderToStaticMarkup(
    <CodeEditor value={BODY} onValueChange={() => {}} language={language} />,
  );
}

/** The text of the colour layer, tags stripped and entities put back. */
function ghostText(html: string): string | null {
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1];
  if (pre == null) return null;
  return pre
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("CodeEditor", () => {
  /**
   * The colours are a second copy of the body behind a transparent textarea.
   * If the copy is not character for character the same, plus the newline a
   * block drops and a textarea keeps, the two run out of line and the colours
   * land on the wrong text.
   */
  it("draws the same characters as the textarea holds, plus the closing line", () => {
    expect(ghostText(render("json"))).toBe(`${BODY}\n`);
  });

  it("leaves the text out of the accessibility tree", () => {
    expect(/<pre[^>]*aria-hidden="true"/.test(render("json"))).toBe(true);
  });

  it("draws no colour layer for a body that is not JSON", () => {
    expect(ghostText(render("text"))).toBeNull();
  });

  /**
   * The textarea is what gives the editor a height. Laid out absolute, like
   * the colour layer, it left the box with none, and a caller that set no
   * height of its own drew the body editor zero pixels tall (#116).
   */
  it("keeps the textarea in flow, so the editor has a height of its own", () => {
    const textarea = /<textarea[^>]*>/.exec(render("json"))?.[0] ?? "";
    expect(textarea).not.toMatch(/\babsolute\b/);
    expect(textarea).toMatch(/rows="8"/);
  });
});
