import { describe, expect, it } from "vitest";
import { autoFontSize, BASE_FONT_SIZE, FONT_SIZES, stepFrom } from "./uiScale";

describe("automatic scale", () => {
  it("leaves the canvas untouched at every window the app can open", () => {
    // 1024x750 is MinWidth/MinHeight in main.go, 1152x780 the default size.
    expect(autoFontSize(1024, 750)).toBe(BASE_FONT_SIZE);
    expect(autoFontSize(1152, 780)).toBe(BASE_FONT_SIZE);
  });

  it("never shrinks, however small the window is dragged", () => {
    expect(autoFontSize(700, 500)).toBe(BASE_FONT_SIZE);
  });

  it("grows with the window and stops at the last step", () => {
    expect(autoFontSize(1440, 900)).toBe(15);
    expect(autoFontSize(1920, 1080)).toBe(18);
    expect(autoFontSize(3840, 2160)).toBe(FONT_SIZES[FONT_SIZES.length - 1]);
  });

  it("is bound by the shorter axis, so a wide short window keeps its rows", () => {
    expect(autoFontSize(3440, 800)).toBe(BASE_FONT_SIZE);
  });

  it("never lays the shell out in less room than the artboard, or than the window", () => {
    for (const [width, height] of [
      [1024, 750],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
      [3440, 1440],
    ] as const) {
      const scale = autoFontSize(width, height) / BASE_FONT_SIZE;
      expect(width / scale).toBeGreaterThanOrEqual(Math.min(width, 1180));
      expect(height / scale).toBeGreaterThanOrEqual(Math.min(height, 764));
    }
  });
});

describe("manual steps", () => {
  it("stops at both ends rather than wrapping", () => {
    expect(stepFrom(12, -1)).toBe(12);
    expect(stepFrom(20, 1)).toBe(20);
  });

  it("walks one entry at a time", () => {
    expect(stepFrom(13, 1)).toBe(14);
    expect(stepFrom(16, -1)).toBe(15);
  });
});
