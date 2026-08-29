import { useEffect, useRef, type CSSProperties } from "react";
import { Columns2, Plus, X } from "lucide-react";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { connectionOf, type ConnectionStatus } from "@/design/data/connections";

/**
 * The canvas paints every tab dot green. Now that the dot rides on the protocol
 * mark instead of taking its own 14px of the strip, it may as well tell the
 * truth — a failed connection showing green was the one thing the tab got wrong.
 */
const STATUS_COLOR: Record<ConnectionStatus, string> = {
  online: "var(--c-ok)",
  offline: "var(--c-muted-2)",
  failed: "var(--c-err)",
};

/**
 * Shared metrics from the canvas tab strip. Tabs keep their content width — a
 * short name gets a short tab — but `flex-shrink` and `--mqs-tab-min` replace
 * the canvas's `flex: none`, because the merged title bar gives them far less
 * room than their own row did.
 */
const BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "7px",
  /* Held by every tab so selecting one does not grow it past its neighbours. */
  border: "1px solid transparent",
  borderRadius: "8px",
  padding: "5px 11px",
  fontSize: "12px",
  whiteSpace: "nowrap",
  flex: "0 1 auto",
};

/*
 * The canvas also bolds the selected tab. Weight is the one distinction that
 * changes how wide the name measures, so the white fill, the border and the
 * shadow carry it instead and the strip holds still when tabs are switched.
 */
const ACTIVE: CSSProperties = {
  ...BASE,
  background: "var(--c-bg)",
  border: "1px solid var(--c-border)",
  boxShadow: "0 1px 2px rgba(0,0,0,.05)",
};

const IDLE: CSSProperties = {
  ...BASE,
  color: "var(--c-fg-2)",
};

/**
 * The connection tabs, rendered inside the title bar. A tab is a *connection*,
 * not a page — each one keeps its own sidebar position, filters and scroll
 * (5a / 5c).
 */
export function ConnectionTabs({
  tabs,
  active,
  compare,
  onSelect,
  onClose,
  onAdd,
  onSplit,
}: {
  tabs: readonly string[];
  /** null while a global view (connections / settings) is showing. */
  active: string | null;
  /** 5b: split mode replaces the active tab with a single compare tab. */
  compare?: { label: string; detail: string } | null;
  onSelect?: (key: string) => void;
  onClose?: (key: string) => void;
  onAdd?: () => void;
  onSplit?: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip scrolls once tabs hit their floor, so the tab being switched to
  // has to be brought into view — otherwise selecting one from ⌘K or the
  // connection list appears to do nothing.
  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, compare, tabs]);

  if (tabs.length === 0) {
    return (
      <div className="mqs-tabstrip" ref={stripRef}>
        <button type="button" className="mqs-tab-add" aria-label="新建连接" onClick={onAdd}>
          <Plus size={13} aria-hidden />
        </button>
        <span style={{ fontSize: "11px", color: "var(--c-muted-2)", whiteSpace: "nowrap" }}>
          新建连接后会以标签的形式出现在这里
        </span>
      </div>
    );
  }

  return (
    <div className="mqs-tabstrip" role="tablist" ref={stripRef}>
      {tabs.map((key) => {
        const conn = connectionOf(key);
        const on = compare == null && key === active;
        return (
          <div
            key={key}
            role="tab"
            tabIndex={0}
            aria-selected={on}
            className="mqs-tab"
            title={conn.name}
            style={on ? ACTIVE : IDLE}
            onClick={() => onSelect?.(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(key);
              }
            }}
          >
            <span className="mqs-tab-mark">
              <ProtocolIcon protocol={conn.protocol} />
              <span
                className="mqs-tab-dot"
                style={{ background: STATUS_COLOR[conn.status] }}
              />
            </span>
            <span className="mqs-tab-name">{conn.name}</span>
            <button
              type="button"
              className="mqs-tab-close"
              aria-label={`关闭 ${conn.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose?.(key);
              }}
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        );
      })}

      {compare != null && (
        <div
          role="tab"
          aria-selected
          className="mqs-tab mqs-tab-compare"
          /* Two labels and a mark do not fit the tab floor the others
             shrink to; squeezed, the name is the part that vanishes. */
          style={{ ...ACTIVE, flex: "none" }}
        >
          {/* The same mark the title bar's 分屏对照 button carries, in the slot
              a connection tab gives its protocol logo. 16px against those 14px
              filled logos: a stroked icon reads smaller than a solid one. */}
          <span className="mqs-tab-mark">
            <Columns2 size={16} aria-hidden />
          </span>
          <span className="mqs-tab-name">{compare.label}</span>
          <span style={{ fontSize: "10.5px", color: "var(--c-muted)", fontWeight: 400 }}>
            {compare.detail}
          </span>
          <button type="button" className="mqs-tab-close" aria-label="退出分屏" onClick={onSplit}>
            <X size={13} aria-hidden />
          </button>
        </div>
      )}

      <button type="button" className="mqs-tab-add" aria-label="新建连接" onClick={onAdd}>
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}
