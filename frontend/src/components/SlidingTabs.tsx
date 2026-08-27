import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SlidingTabItem<T extends string = string> {
  key: T;
  label: ReactNode;
  count?: number;
}

/**
 * Segmented control with a sliding pill indicator.
 *
 * Animation only runs when the selected `value` changes. Open/mount and
 * count-driven width changes snap instantly so the pill never "fills"
 * from left to right on page entry.
 */
export function SlidingTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: SlidingTabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const prevValueRef = useRef(value);
  const placedRef = useRef(false);

  // Parent screens often rebuild `items` every render; key content so we only
  // re-measure when labels/counts actually change.
  const itemsKey = useMemo(
    () =>
      items
        .map(
          (item) =>
            `${item.key}\0${item.count ?? ""}\0${typeof item.label === "string" ? item.label : ""}`,
        )
        .join("\n"),
    [items],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    const pill = pillRef.current;
    const btn = btnRefs.current.get(value);
    if (!root || !pill || !btn) return;

    const rootRect = root.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const left = btnRect.left - rootRect.left;
    const width = btnRect.width;

    const valueChanged = prevValueRef.current !== value;
    prevValueRef.current = value;
    // Animate only for real tab switches after the pill has been placed once.
    const animate = valueChanged && placedRef.current;

    if (!animate) {
      // Snap: disable transitions for this layout write so width/left changes
      // from mount or count updates never interpolate.
      pill.style.transition = "none";
      pill.style.transform = `translateX(${left}px)`;
      pill.style.width = `${width}px`;
      pill.style.opacity = "1";
      // Force the browser to commit the un-transitioned style before any later
      // animated update (e.g. user clicks another tab in the same frame).
      void pill.offsetWidth;
      pill.style.removeProperty("transition");
      placedRef.current = true;
      return;
    }

    pill.style.removeProperty("transition");
    pill.style.transform = `translateX(${left}px)`;
    pill.style.width = `${width}px`;
    pill.style.opacity = "1";
  }, [value, itemsKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;

    const snapToActive = () => {
      const pill = pillRef.current;
      const btn = btnRefs.current.get(prevValueRef.current);
      if (!root || !pill || !btn) return;
      const rootRect = root.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btnRect.left - rootRect.left}px)`;
      pill.style.width = `${btnRect.width}px`;
      pill.style.opacity = "1";
      void pill.offsetWidth;
      pill.style.removeProperty("transition");
      placedRef.current = true;
    };

    const ro = new ResizeObserver(() => snapToActive());
    ro.observe(root);
    for (const btn of btnRefs.current.values()) ro.observe(btn);
    return () => ro.disconnect();
  }, [itemsKey]);

  // Arrow-key navigation with a roving tabindex, per the ARIA tabs pattern.
  const select = (index: number) => {
    const count = items.length;
    if (count === 0) return;
    const item = items[((index % count) + count) % count];
    if (!item) return;
    onChange(item.key);
    btnRefs.current.get(item.key)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.key === value);
    const moves: Record<string, number | undefined> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div
      ref={rootRef}
      className={cn("mqs-tabs mqs-tabs-sliding", className)}
      role="tablist"
      onKeyDown={onKeyDown}
    >
      <div ref={pillRef} className="mqs-tabs-indicator" aria-hidden />
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              if (el) btnRefs.current.set(item.key, el);
              else btnRefs.current.delete(item.key);
            }}
            className={cn("tab", active && "active")}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {typeof item.count === "number" && item.count > 0 && (
              <span className="text-muted-foreground font-mono-design text-fs-11 tabular-nums">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
