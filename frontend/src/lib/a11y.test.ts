import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { activatableRowProps } from "./a11y";

function keyEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement> & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

describe("activatableRowProps", () => {
  it("puts the row in the tab order", () => {
    expect(activatableRowProps(() => {}).tabIndex).toBe(0);
  });

  it("activates on Enter and Space", () => {
    for (const key of ["Enter", " "]) {
      const onActivate = vi.fn();
      const event = keyEvent(key);
      activatableRowProps(onActivate).onKeyDown(event);
      expect(onActivate).toHaveBeenCalledTimes(1);
      // Space must not scroll the surrounding list.
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores other keys and leaves their default behaviour alone", () => {
    for (const key of ["Escape", "a", "Tab", "ArrowDown"]) {
      const onActivate = vi.fn();
      const event = keyEvent(key);
      activatableRowProps(onActivate).onKeyDown(event);
      expect(onActivate).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});
