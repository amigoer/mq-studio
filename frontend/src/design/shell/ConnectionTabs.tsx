import { useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import type { Connection, ConnectionStatus } from "@/design/data/connections";

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
  connections,
  active,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: readonly string[];
  /** The profiles behind them; a tab whose profile is gone is not drawn. */
  connections: readonly Connection[];
  /** null while a global view (connections / settings) is showing. */
  active: string | null;
  onSelect?: (key: string) => void;
  onClose?: (key: string) => void;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);

  // The strip scrolls once tabs hit their floor, so the tab being switched to
  // has to be brought into view — otherwise selecting one from ⌘K or the
  // connection list appears to do nothing.
  useEffect(() => {
    const selected = stripRef.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs]);

  if (tabs.length === 0) {
    return (
      <div className="mqs-tabstrip" ref={stripRef}>
        <button type="button" className="mqs-tab-add" aria-label={t("shell.tabs.new")} onClick={onAdd}>
          <Plus size={13} aria-hidden />
        </button>
        <span style={{ fontSize: "11px", color: "var(--c-muted-2)", whiteSpace: "nowrap" }}>
          {t("shell.tabs.newHint")}
        </span>
      </div>
    );
  }

  return (
    <div className="mqs-tabstrip" role="tablist" ref={stripRef}>
      {tabs.map((key) => {
        const conn = connections.find((c) => c.key === key);
        if (conn == null) return null;
        const on = key === active;
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
              {conn.protocol != null && <ProtocolIcon protocol={conn.protocol} />}
              <span
                className="mqs-tab-dot"
                style={{ background: STATUS_COLOR[conn.status] }}
              />
            </span>
            <span className="mqs-tab-name">{conn.name}</span>
            <button
              type="button"
              className="mqs-tab-close"
              aria-label={t("shell.tabs.close", { name: conn.name })}
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

      <button type="button" className="mqs-tab-add" aria-label={t("shell.tabs.new")} onClick={onAdd}>
        <Plus size={13} aria-hidden />
      </button>
    </div>
  );
}
