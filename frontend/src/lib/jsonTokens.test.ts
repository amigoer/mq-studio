import { describe, expect, it } from "vitest";
import { tokenizeJson, type JsonToken, type JsonTokenKind } from "./jsonTokens";

/** The kinds in order, with the runs that carry no colour left out. */
function kinds(source: string): JsonTokenKind[] {
  return tokenizeJson(source)
    .filter((token) => token.kind !== "plain")
    .map((token) => token.kind);
}

function textOf(kind: JsonTokenKind, source: string): string[] {
  return tokenizeJson(source)
    .filter((token: JsonToken) => token.kind === kind)
    .map((token) => token.text);
}

describe("tokenizeJson", () => {
  it("puts every character in exactly one token, in order", () => {
    const samples = [
      '{\n  "orderId": "ORD-TEST-001"\n}',
      '{"a":[1,2.5,-3e10,true,null],"b":{"c":"d"}}',
      '  \t\n',
      '{"unclosed": "still typing',
      "not json at all, 42 of them",
      "",
    ];
    for (const source of samples) {
      expect(tokenizeJson(source).map((token) => token.text).join("")).toBe(source);
    }
  });

  it("tells a key from a string value by the colon that follows", () => {
    expect(kinds('{"a": "b"}')).toEqual(["punct", "key", "punct", "string", "punct"]);
    // The colon may be on the next line, and an array holds no keys at all.
    expect(textOf("key", '{"a"\n: 1}')).toEqual(['"a"']);
    expect(textOf("key", '["a", "b"]')).toEqual([]);
  });

  it("separates numbers from literals", () => {
    expect(kinds("[1, -2.5, 3e-4]")).toEqual([
      "punct", "number", "punct", "number", "punct", "number", "punct",
    ]);
    expect(textOf("literal", "[true, false, null]")).toEqual(["true", "false", "null"]);
  });

  it("leaves anything that is not JSON plain", () => {
    // `true` inside a word is a word; a bare word keeps its digits.
    expect(textOf("literal", "[truthy, untrue]")).toEqual([]);
    expect(textOf("number", "[abc123]")).toEqual([]);
  });

  it("stops an unclosed string at the end of its line", () => {
    const tokens = tokenizeJson('{\n  "a": "oops\n  "b": 1\n}');
    expect(tokens.filter((token) => token.kind === "string").map((token) => token.text)).toEqual([
      '"oops',
    ]);
    // The line below still colours normally.
    expect(textOf("number", '{\n  "a": "oops\n  "b": 1\n}')).toEqual(["1"]);
  });

  it("colours an escaped quote as part of its string", () => {
    expect(textOf("string", '{"a": "say \\"hi\\" now"}')).toEqual(['"say \\"hi\\" now"']);
  });
});
