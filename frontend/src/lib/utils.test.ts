import { describe, expect, it } from "vitest";
import { cn, formatErrorMessage, withMinDuration } from "./utils";

describe("cn", () => {
  it("keeps only the last size from the custom fs-* scale", () => {
    expect(cn("text-fs-11", "text-fs-13")).toBe("text-fs-13");
  });

  it("does not confuse a size token with a text colour", () => {
    expect(cn("text-fs-12", "text-muted-foreground")).toBe(
      "text-fs-12 text-muted-foreground",
    );
  });
});

describe("formatErrorMessage", () => {
  it("reads message field from objects", () => {
    expect(formatErrorMessage({ message: "boom" })).toBe("boom");
  });

  it("uses Error.message", () => {
    expect(formatErrorMessage(new Error("plain"))).toBe("plain");
  });

  it("keeps a Go error message intact even when it contains JSON", () => {
    expect(
      formatErrorMessage(new Error('failed to parse: {"message":"inner"}')),
    ).toBe('failed to parse: {"message":"inner"}');
  });

  it("stringifies plain values when no message field exists", () => {
    expect(formatErrorMessage(123)).toBe("123");
    expect(formatErrorMessage(null)).toBe("null");
  });
});

describe("withMinDuration", () => {
  it("resolves the underlying value", async () => {
    const value = await withMinDuration(Promise.resolve(42), 0);
    expect(value).toBe(42);
  });

  it("waits at least minMs", async () => {
    const started = Date.now();
    await withMinDuration(Promise.resolve("ok"), 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
