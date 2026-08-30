import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Bell, ChevronRight } from "lucide-react";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { Button } from "@/components/ui/button";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Status } from "@/components";
import { Badge, ICON_CLASS, IconBtn } from "@/design/shell/IconBtn";
import { useAlertCenter, type AlertGroup } from "@/hooks/useAlertCenter";
import { useSettings } from "@/hooks/useSettings";
import { protocolOfKind } from "@/design/data/connections";
import { alertHeadline, alertMeta, alertValue } from "@/lib/alertText";
import type { AlertRecord } from "@/lib/alertCenter";
import type { AlertSeverity } from "@/lib/alertDerive";
import type { ProtocolId } from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/**
 * Board 9c — the bell and its popover, as one component.
 *
 * Grouped by connection because that is how the alerts arrive: the centre
 * watches every open connection at once, while the sidebar's 告警 entry rules
 * only the tab it is in.
 *
 * Everything here is live. `useAlertCenter` polls the connections, keeps the
 * records, and remembers what has been seen; this draws them and reports the
 * two things the user can do about one -- mark it read, or go to the
 * connection it came from.
 */

/** The dot beside a row. Recovered and already-read rows lose their colour. */
function dotColour(record: AlertRecord): string {
  if (record.resolvedAt != null || record.read) return "var(--c-muted-2)";
  const bySeverity: Record<AlertSeverity, string> = {
    crit: "var(--c-err)",
    warn: "var(--c-warn)",
    info: "var(--c-ok)",
  };
  return bySeverity[record.severity];
}

export function NotificationBell({
  dimmed = false,
  onOpenAlertSettings,
  onOpenConnection,
}: {
  /** 8b: with no connections the affordance reads as inert. */
  dimmed?: boolean;
  onOpenAlertSettings?: () => void;
  /** Where a row goes when it is clicked: the connection it fired on. */
  onOpenConnection?: (connectionId: number) => void;
}) {
  const { t } = useTranslation();
  const { groups, unread, online, markAllRead, markRead } = useAlertCenter();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconBtn
          style={{ position: "relative", ...(dimmed && { color: "var(--c-disabled)" }) }}
          title={
            unread > 0
              ? t("shell.titleBar.notificationsUnread", { count: unread })
              : t("shell.titleBar.notifications")
          }
        >
          <Bell className={ICON_CLASS} aria-hidden />
          {unread > 0 && <Badge tone="var(--c-err)" />}
        </IconBtn>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[400px] overflow-hidden p-0"
        /* It hangs off the bell, which is above its own right corner. */
        style={{ transformOrigin: "top right" }}
      >
        <div className="flex items-center border-b px-4 py-3">
          <b className="text-[13px]">{t("shell.notifications.title")}</b>
          {unread > 0 && (
            <Status tone="err" className="ml-2 text-[10px]">
              {t("shell.notifications.unread", { count: unread })}
            </Status>
          )}
          <span className="flex-1" />
          <Button
            variant="link"
            size="sm"
            disabled={unread === 0}
            onClick={markAllRead}
            className="h-auto p-0 text-[11.5px] text-(--c-ok) disabled:text-(--c-disabled) disabled:opacity-100"
          >
            {t("shell.notifications.markAllRead")}
          </Button>
        </div>

        {groups.length === 0 ? (
          <Empty className="py-8">
            <EmptyMedia variant="icon">
              <Bell aria-hidden />
            </EmptyMedia>
            <EmptyTitle className="text-[12.5px]">
              {t(online ? "shell.notifications.empty" : "shell.notifications.emptyOffline")}
            </EmptyTitle>
          </Empty>
        ) : (
          /* Four rows and a bit, so a long list reads as scrollable. */
          <ScrollArea className="max-h-[340px] overflow-y-auto">
            {groups.map((group) => (
              <AlertGroupRows
                key={group.connectionId}
                group={group}
                timezone={settings.timezone === "utc" ? "utc" : "local"}
                onSelect={(record) => {
                  markRead(record.id);
                  if (onOpenConnection == null) return;
                  setOpen(false);
                  onOpenConnection(record.connectionId);
                }}
              />
            ))}
          </ScrollArea>
        )}

        <div className="flex items-center border-t px-4 py-3">
          <span className="text-[11px] text-(--c-muted)">
            {settings.desktopNotifications
              ? t("shell.notifications.desktopOn")
              : t("shell.notifications.desktopOff")}
          </span>
          <span className="flex-1" />
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setOpen(false);
              onOpenAlertSettings?.();
            }}
            className="h-auto gap-1 p-0 text-[11.5px] text-(--c-ok)"
          >
            {t("shell.notifications.alertSettings")}
            <ArrowRight size={13} aria-hidden />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Exported for the render test: the popover body cannot be server-rendered. */
export function AlertGroupRows({
  group,
  timezone,
  onSelect,
}: {
  group: AlertGroup;
  timezone: "local" | "utc";
  onSelect: (record: AlertRecord) => void;
}) {
  const { t } = useTranslation();
  const protocol: ProtocolId | null =
    group.kind != null ? protocolOfKind(group.kind) : null;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-4 pt-2.5 pb-1 text-[10.5px] text-(--c-muted)">
        {protocol != null && <ProtocolIcon protocol={protocol} size={12} />}
        {group.name}
      </div>
      {group.records.map((record) => {
        const recovered = record.resolvedAt != null;
        const value = alertValue(record);
        return (
          <button
            key={record.id}
            type="button"
            onClick={() => onSelect(record)}
            className={cn(
              "flex w-full gap-2.5 border-b px-4 py-2 text-left last:border-b-0 hover:bg-(--c-fill)",
              (recovered || record.read) && "opacity-60",
            )}
          >
            <span
              className="dotg mt-[5px]"
              style={{ background: dotColour(record) }}
              aria-hidden
            />
            <span className="flex-1 text-[12px]">
              {/* 9c sets a live headline in medium and leaves a recovered one plain. */}
              {recovered ? (
                <>
                  {alertHeadline(t, record)}
                  <span className="text-(--c-muted)">
                    {t("shell.notifications.recovered")}
                  </span>
                </>
              ) : (
                <b className="font-medium">{alertHeadline(t, record)}</b>
              )}
              {value != null && !recovered && (
                <>
                  {" "}
                  <span className="mono3 text-(--c-warn-text)">{value}</span>
                </>
              )}
              <span className="mt-px block text-[10.5px] text-(--c-muted)">
                {alertMeta(t, record, { timezone })}
              </span>
            </span>
            {!recovered && (
              <ChevronRight
                size={14}
                className="flex-none self-center text-(--c-disabled)"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
