import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight } from "lucide-react";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Panel, Status } from "@/components";
import { useSettings } from "@/hooks/useSettings";
import type { ProtocolId } from "@/design/data/protocols";
import { DURATION, usePresence } from "@/lib/motion";

/**
 * Board 9c — the 通知 popover. Alerts are grouped by connection because they
 * arrive across every open tab; the sidebar's 告警 page only rules one.
 *
 * The alerts themselves are the canvas's: `useAlerts` derives them from live
 * cluster data, which the boards do not have yet. Everything around them is
 * real -- the unread count, 全部已读, the jump to the thresholds that produce
 * them, and whether desktop notifications are actually on.
 */

type Alert = {
  key: string;
  connection: string;
  protocol: ProtocolId;
  tone: "warn" | "info";
  /* Locale keys. The row is drawn here rather than stored, so a language
     change relabels the popover instead of leaving the drawn JSX behind. */
  title: string;
  meta: string;
  /** The measurement the alert fired on, set beside the title in mono. */
  value?: string;
  /** 9c sets the unresolved titles in medium and leaves the resolved one plain. */
  plain?: boolean;
  /** Resolved on its own; it arrives already read. */
  resolved?: boolean;
};

const ALERTS: readonly Alert[] = [
  {
    key: "order-settle-lag",
    connection: "rocketmq-order",
    protocol: "rocketmq",
    tone: "warn",
    title: "shell.notifications.alerts.lagTitle",
    meta: "shell.notifications.alerts.lagMeta",
    value: "982",
  },
  {
    key: "broker-b-disk",
    connection: "rocketmq-order",
    protocol: "rocketmq",
    tone: "warn",
    title: "shell.notifications.alerts.diskTitle",
    meta: "shell.notifications.alerts.diskMeta",
  },
  {
    key: "orders-created-isr",
    connection: "prod-kafka-cn",
    protocol: "kafka",
    tone: "info",
    title: "shell.notifications.alerts.isrTitle",
    meta: "10:12 - 10:15",
    plain: true,
    resolved: true,
  },
];

/** How many of the drawn alerts still count as unread. */
export const UNREAD_ALERTS = ALERTS.filter((alert) => alert.resolved !== true).length;

export function NotificationCenter({
  open,
  read = false,
  onClose,
  onMarkAllRead,
  onOpenAlertSettings,
}: {
  open: boolean;
  read?: boolean;
  onClose?: () => void;
  onMarkAllRead?: () => void;
  onOpenAlertSettings?: () => void;
}) {
  const { t } = useTranslation();
  const { mounted, state } = usePresence(open, DURATION.fast);
  const ref = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();
  const unread = read ? 0 : UNREAD_ALERTS;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  let previousConnection: string | null = null;

  return (
    <div ref={ref} style={{ position: "absolute", top: "36px", right: "58px", zIndex: 40 }}>
      <Panel
        className="mqs-drop"
        data-state={state}
        style={{
          width: "400px",
          overflow: "hidden",
          boxShadow: "0 18px 50px rgba(0,0,0,.18)",
          /* It hangs off the bell, which is above its own right corner. */
          transformOrigin: "top right",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "13px 16px",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          <b style={{ fontSize: "13px" }}>{t("shell.notifications.title")}</b>
          {unread > 0 && (
            <Status tone="err" className="ml-2 text-[10px]">
              {t("shell.notifications.unread", { count: unread })}
            </Status>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={unread === 0}
            onClick={onMarkAllRead}
            style={{
              font: "inherit",
              fontSize: "11.5px",
              border: "none",
              background: "none",
              padding: 0,
              color: unread === 0 ? "var(--c-disabled)" : "var(--c-ok)",
            }}
          >
            {t("shell.notifications.markAllRead")}
          </button>
        </div>

        {ALERTS.map((alert) => {
          const heading = alert.connection === previousConnection ? null : alert;
          previousConnection = alert.connection;
          const dim = read || alert.resolved === true;
          return (
            <div key={alert.key}>
              {heading != null && (
                <GroupLabel protocol={heading.protocol} name={heading.connection} />
              )}
              <Item
                dot={
                  alert.resolved === true || read
                    ? "var(--c-muted-2)"
                    : alert.tone === "warn"
                      ? "var(--c-warn)"
                      : "var(--c-ok)"
                }
                dim={dim}
                title={
                  <>
                    {alert.plain === true ? (
                      t(alert.title)
                    ) : (
                      <b style={{ fontWeight: 500 }}>{t(alert.title)}</b>
                    )}
                    {alert.value != null && (
                      <>
                        {" "}
                        <span className="mono3" style={{ color: "var(--c-warn-text)" }}>
                          {alert.value}
                        </span>
                      </>
                    )}
                  </>
                }
                meta={t(alert.meta)}
                chevron={alert.resolved !== true}
              />
            </div>
          );
        })}

        <div style={{ display: "flex", alignItems: "center", padding: "11px 16px" }}>
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {settings.desktopNotifications
              ? t("shell.notifications.desktopOn")
              : t("shell.notifications.desktopOff")}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onOpenAlertSettings}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              font: "inherit",
              fontSize: "11.5px",
              border: "none",
              background: "none",
              padding: 0,
              color: "var(--c-ok)",
            }}
          >
            {t("shell.notifications.alertSettings")}
            <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      </Panel>
    </div>
  );
}

function GroupLabel({ protocol, name }: { protocol: ProtocolId; name: string }) {
  return (
    <div
      style={{
        padding: "10px 16px 4px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "10.5px",
        color: "var(--c-muted)",
      }}
    >
      <ProtocolIcon protocol={protocol} size={12} />
      {name}
    </div>
  );
}

function Item({
  dot,
  title,
  meta,
  chevron,
  dim,
}: {
  dot: string;
  title: ReactNode;
  meta: string;
  chevron?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        padding: "8px 16px",
        borderBottom: "1px solid var(--c-rule)",
        opacity: dim ? 0.6 : undefined,
      }}
    >
      <span className="dotg" style={{ background: dot, marginTop: "5px" }} />
      <div style={{ flex: 1, fontSize: "12px" }}>
        {title}
        <div style={{ fontSize: "10.5px", color: "var(--c-muted)", marginTop: "1px" }}>{meta}</div>
      </div>
      {chevron && (
        <ChevronRight
          size={14}
          style={{ color: "var(--c-disabled)", alignSelf: "center", flex: "none" }}
          aria-hidden
        />
      )}
    </div>
  );
}
