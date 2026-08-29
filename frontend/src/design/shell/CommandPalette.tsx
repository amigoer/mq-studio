import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Plug, Search, Settings, RefreshCw, Plus, type LucideIcon } from "lucide-react";
import { Card } from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { PROTOCOLS, type PageId, type ProtocolId } from "@/design/data/protocols";
import type { Connection } from "@/design/data/connections";

/**
 * Board 9d — ⌘K across every connection.
 *
 * The canvas draws Topic and 消费者组 hits alongside the connections; those need
 * the MQ data plane, so what is here is what the shell itself knows: the
 * connections, the pages of the tab in front, and the window's own commands.
 * The drawn sections slot back in beside them once the boards are wired.
 */

type Hit = {
  key: string;
  group: string;
  name: string;
  meta: string;
  icon?: LucideIcon;
  protocol?: ProtocolId;
  run: () => void;
};

export function CommandPalette({
  open,
  query,
  connections,
  protocol,
  onQueryChange,
  onOpenConnection,
  onOpenPage,
  onNewConnection,
  onOpenSettings,
  onCheckUpdate,
  onClose,
}: {
  open: boolean;
  query: string;
  connections: readonly Connection[];
  /** The protocol of the tab in front, whose pages are reachable from here. */
  protocol: ProtocolId | null;
  onQueryChange?: (q: string) => void;
  onOpenConnection?: (key: string) => void;
  onOpenPage?: (page: PageId) => void;
  onNewConnection?: () => void;
  onOpenSettings?: () => void;
  onCheckUpdate?: () => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (...fields: string[]) =>
      needle === "" || fields.some((field) => field.toLowerCase().includes(needle));

    const out: Hit[] = [];
    for (const connection of connections) {
      // The row's action is to open a tab, which a family with no boards has
      // nothing to open; it stays findable on the connection list.
      if (connection.protocol == null) continue;
      if (!matches(connection.name, connection.address, connection.protocolLabel)) continue;
      out.push({
        key: `connection:${connection.key}`,
        group: t("shell.palette.connections"),
        name: connection.name,
        meta: `${connection.protocolLabel} · ${connection.address}`,
        protocol: connection.protocol,
        run: () => onOpenConnection?.(connection.key),
      });
    }
    if (protocol != null) {
      for (const group of PROTOCOLS[protocol].nav) {
        for (const entry of group.items) {
          const label = t(entry.label);
          if (!matches(label, entry.id)) continue;
          out.push({
            key: `page:${entry.id}`,
            group: t("shell.palette.pages"),
            name: label,
            meta: group.label != null ? t(group.label) : t("shell.palette.navigation"),
            icon: entry.icon,
            run: () => onOpenPage?.(entry.id),
          });
        }
      }
    }
    const commands: readonly { key: string; name: string; icon: LucideIcon; run?: () => void }[] = [
      { key: "newConnection", name: t("shell.palette.newConnection"), icon: Plus, run: onNewConnection },
      { key: "openSettings", name: t("shell.palette.openSettings"), icon: Settings, run: onOpenSettings },
      { key: "checkUpdate", name: t("shell.palette.checkUpdate"), icon: RefreshCw, run: onCheckUpdate },
    ];
    for (const command of commands) {
      if (!matches(command.name)) continue;
      out.push({
        key: `command:${command.key}`,
        group: t("shell.palette.commands"),
        name: command.name,
        meta: t("shell.palette.window"),
        icon: command.icon,
        run: () => command.run?.(),
      });
    }
    return out;
  }, [
    connections,
    onCheckUpdate,
    onNewConnection,
    onOpenConnection,
    onOpenPage,
    onOpenSettings,
    protocol,
    query,
    t,
  ]);

  // A shorter list can leave the cursor past its end; clamping on render keeps
  // the highlight and the Enter key on the same row.
  const selected = hits.length === 0 ? -1 : Math.min(cursor, hits.length - 1);

  useEffect(() => {
    if (open) setCursor(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose?.();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((current) => {
          const next = current + (event.key === "ArrowDown" ? 1 : -1);
          return Math.min(hits.length - 1, Math.max(0, next));
        });
        return;
      }
      if (event.key === "Enter" && selected >= 0) {
        event.preventDefault();
        hits[selected]?.run();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hits, onClose, open, selected]);

  // Keeps the keyboard cursor in view once the list is longer than the box.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  let previousGroup: string | null = null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--c-scrim)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "90px",
        zIndex: 30,
      }}
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-label={t("shell.palette.label")}
        style={{ width: "560px", overflow: "hidden", boxShadow: "0 18px 50px rgba(0,0,0,.22)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "13px 16px",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          <Search size={15} style={{ color: "var(--c-muted)" }} aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange?.(e.target.value)}
            placeholder={t("shell.palette.placeholder")}
            style={{
              flex: 1,
              font: "inherit",
              fontSize: "13.5px",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "inherit",
            }}
          />
          <span className="mono3" style={{ fontSize: "10px", color: "var(--c-muted-2)" }}>
            ESC
          </span>
        </div>

        <div
          ref={listRef}
          className="mqs-scroll"
          style={{ padding: "8px", maxHeight: "320px", overflowY: "auto" }}
        >
          {hits.length === 0 && (
            <div
              style={{
                padding: "20px 10px",
                textAlign: "center",
                fontSize: "12px",
                color: "var(--c-muted)",
              }}
            >
              {t("shell.palette.empty")}
            </div>
          )}
          {hits.map((hit, index) => {
            const heading = hit.group === previousGroup ? null : hit.group;
            previousGroup = hit.group;
            return (
              <div key={hit.key}>
                {heading != null && (
                  <div
                    className="sec3"
                    style={{ padding: index === 0 ? "2px 10px 6px" : "8px 10px 6px" }}
                  >
                    {heading}
                  </div>
                )}
                <button
                  type="button"
                  data-selected={index === selected}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => {
                    hit.run();
                    onClose?.();
                  }}
                  style={{
                    ...ROW,
                    width: "100%",
                    border: "none",
                    font: "inherit",
                    textAlign: "left",
                    background: index === selected ? "var(--c-fill)" : "transparent",
                    color: index === selected ? "inherit" : "var(--c-fg-2)",
                  }}
                >
                  <span className="nic">
                    {hit.protocol != null ? (
                      <ProtocolIcon protocol={hit.protocol} size={15} />
                    ) : hit.icon != null ? (
                      <hit.icon size={16} aria-hidden />
                    ) : (
                      <Plug size={16} aria-hidden />
                    )}
                  </span>
                  <span className="mono3" style={{ fontSize: "12px", fontWeight: index === selected ? 500 : undefined }}>
                    {hit.name}
                  </span>
                  <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{hit.meta}</span>
                  {index === selected && (
                    <>
                      <span style={{ flex: 1 }} />
                      <span
                        className="mono3"
                        style={{ fontSize: "10px", color: "var(--c-muted-2)" }}
                      >
                        {t("shell.palette.hintOpen")}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: "14px",
            padding: "9px 16px",
            borderTop: "1px solid var(--c-border)",
            fontSize: "10.5px",
            color: "var(--c-muted-2)",
          }}
        >
          <span>{t("shell.palette.hintSelect")}</span>
          <span>{t("shell.palette.hintOpen")}</span>
          <span style={{ flex: 1 }} />
          <span>{t("shell.palette.results", { count: hits.length })}</span>
        </div>
      </Card>
    </div>
  );
}

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "7px 10px",
  borderRadius: "8px",
  fontSize: "12.5px",
};
