import type { CSSProperties, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

/** The content column: `flex:1;display:flex;flex-direction:column;min-width:0`. */
export function Page({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, ...style }}
    >
      {children}
    </div>
  );
}

/** `.hd3` — page title, subtitle and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="hd3">
      <div>
        <h2>{title}</h2>
        {subtitle != null && <div className="sub">{subtitle}</div>}
      </div>
      <span style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

/**
 * The re-read every live board offers in its header.
 *
 * The icon is always drawn and only turns while a read is in flight. Drawing
 * it for the refresh alone moved the label and widened the button on every
 * click: the size variant drops its side padding as soon as the button holds
 * an icon, so the icon arrived and the padding shrank at the same moment.
 */
export function RefreshButton({
  refreshing,
  online,
  onClick,
}: {
  refreshing: boolean;
  /** Nothing to re-read while no connection is dialled. */
  online: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" disabled={refreshing || !online} onClick={onClick}>
      <RefreshCw className={refreshing ? "mqs-turning" : undefined} aria-hidden />
      {t("board.common.refresh")}
    </Button>
  );
}

/** `.tbar3` — the filter row under the header. */
export function Toolbar({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="tbar3" style={style}>
      {children}
    </div>
  );
}

/** The footer strip (8a: "6 个连接 · 4 在线 · 1 失败"). */
export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "9px 20px",
        borderTop: "1px solid var(--c-border)",
        background: "var(--c-panel)",
        fontSize: "11px",
        color: "var(--c-muted)",
      }}
    >
      {left}
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

/** The scrollable page body used by the dashboard-style boards. */
export function PageBody({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="mqs-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The row that holds the list and the detail sheet (3c and every list board). */
export function ListArea({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ flex: 1, display: "flex", minHeight: 0, ...style }}>{children}</div>;
}

/** The scrolling list column next to a sheet. */
export function ListPane({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="mqs-scroll" style={{ flex: 1, minWidth: 0, overflow: "auto", ...style }}>
      {children}
    </div>
  );
}

/** `.ph3` rows standing in for the rest of a long list, as the canvas draws them. */
export function SkeletonRows({ widths, colSpan }: { widths: readonly string[]; colSpan: number }) {
  return (
    <>
      {widths.map((w, i) => (
        <tr key={i}>
          <td colSpan={colSpan} className="px-3.5 py-2">
            <Skeleton className="h-3.5" style={{ width: w }} />
          </td>
        </tr>
      ))}
    </>
  );
}

/** The selection action bar pinned under a checkbox list (9b, 14c, 15a-15d). */
export function BulkBar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 20px",
        borderTop: "1px solid var(--c-border)",
        background: "var(--c-panel)",
        fontSize: "12px",
      }}
    >
      {children}
      <span style={{ flex: 1 }} />
      {hint != null && <span style={{ color: "var(--c-muted)", fontSize: "11px" }}>{hint}</span>}
    </div>
  );
}

/** The dot and the name take the tone of the state they are reporting. */
const STATUS_TONE: Record<string, string> = {
  online: "var(--c-ok-text)",
  failed: "var(--c-err-text)",
  offline: "var(--c-muted)",
};

/**
 * Board 5a's footer: the active tab's own connection state.
 *
 * It carries only what the app has actually measured. The canvas drew a
 * latency figure beside the name and a line promising that background tabs
 * keep their connection and alert subscriptions; the first was a dash whenever
 * nothing had been dialled this session, and the second was a fixed sentence
 * dressed as status. A status bar that says something it did not check is
 * worse than a shorter one.
 *
 * Latency is therefore printed only where it exists: it is the round trip of
 * the connect or test that last succeeded, which is the only figure the admin
 * protocol gives us, and a tab restored onto an already-open connection has
 * none.
 */
export function TabStatusBar({
  connection,
  address,
  status,
  latency,
  tabCount,
  onlineCount,
}: {
  connection: string;
  /** The endpoint this tab is reading, which is known whether or not it is up. */
  address: string;
  status: string;
  /** Undefined until a dial in this session timed one. */
  latency?: string;
  tabCount: number;
  onlineCount: number;
}) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status] ?? "var(--c-muted)";
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "7px 20px",
        borderTop: "1px solid var(--c-border)",
        fontSize: "10.5px",
        color: "var(--c-muted)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "5px", color: tone }}>
        <span className="mqs-dot" aria-hidden />
        {connection}
      </span>
      <span className="mono3">{address}</span>
      {latency != null && <span className="mono3">{latency}</span>}
      <span style={{ flex: 1 }} />
      <span>{t("shell.status.tabs", { tabs: tabCount, online: onlineCount })}</span>
    </div>
  );
}
