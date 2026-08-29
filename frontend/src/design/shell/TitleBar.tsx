import { useEffect, useState, type ReactNode } from "react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Bell, Columns2, RefreshCw, Settings } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { AppLogo } from "@/design/icons/AppLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isMac } from "@/api/platform";
import { WindowControls } from "./WindowControls";

/**
 * `.tb2` from the canvas, carrying the connection tabs inline. The canvas draws
 * tabs on their own 39px strip below; merging the two rows buys that height
 * back for content at the cost of horizontal room for tabs, which is why the
 * strip scrolls and 分屏对照 moved into the icon cluster.
 *
 * The canvas drew the macOS traffic lights by hand; the real window has the
 * native ones (main.go keeps the frame on darwin and moves the buttons onto
 * this bar), so the row only reserves the width they take. Everywhere else the
 * window is frameless and the bar ends with its own window buttons.
 */
/*
 * lucide draws on a 24 grid and inks about 20 of it, so 17px puts these within
 * a pixel of the 14px the GitHub mark fills solid, and a stroked set beside a
 * filled brand mark reads as one row. Expressed in rem (17/13) so the cluster
 * follows the font-size setting, and carrying `size-` so the Button's own
 * icon sizing rule leaves it alone.
 */
const ICON_CLASS = "size-[1.3rem]";

/** A 26px ghost icon button in the title bar cluster. */
function IconBtn({
  active,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={active}
      className={cn(
        "flex-none text-foreground/80",
        active && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** The corner mark on an icon button. It sits over the glyph, so it needs an edge. */
function Badge({ tone }: { tone: string }) {
  return (
    <span
      style={{
        position: "absolute",
        top: "3px",
        right: "3px",
        width: "6px",
        height: "6px",
        borderRadius: "99px",
        background: tone,
        boxShadow: "0 0 0 1.5px var(--c-bg)",
      }}
    />
  );
}

export function TitleBar({
  tabs,
  homeActive,
  splitActive,
  dimmed = false,
  refreshing = false,
  updateReady = false,
  notifications = 0,
  onHome,
  onSearch,
  onRefresh,
  onGithub,
  onNotifications,
  onSettings,
  onSplit,
}: {
  tabs?: ReactNode;
  /** True while the connection list is the page being shown. */
  homeActive?: boolean;
  splitActive?: boolean;
  /** 8b: with no connections the search and notification affordances read as inert. */
  dimmed?: boolean;
  /** True while the update check the button starts is still out. */
  refreshing?: boolean;
  updateReady?: boolean;
  /** Unread alerts. The canvas draws the mark on 检查更新 only; the bell earns
   *  the same one, or the count is only readable by opening the popover. */
  notifications?: number;
  onHome?: () => void;
  onSearch?: () => void;
  onRefresh?: () => void;
  onGithub?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onSplit?: () => void;
}) {
  const { t } = useTranslation();
  const mac = isMac();
  /*
   * The update icon turns while the check is out, not for a fixed circle per
   * click: a spin that ends before the answer does is theatre. It outlives the
   * answer by at most the rest of the current turn -- `onAnimationIteration`
   * ends it on a whole circle, so it never snaps back from a random angle.
   */
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (refreshing) setSpinning(true);
    // Motion turned off zeroes the duration, so no iteration will ever arrive
    // to close the turn -- and there is no turn to close.
    else if (document.documentElement.dataset.animations === "off") setSpinning(false);
  }, [refreshing]);

  return (
    <div
      className={mac ? "tb2 tb2--mac" : "tb2"}
      style={{ background: "var(--c-bar)" }}
    >
      {/*
       * Mark only — the wordmark it sat next to was traded for tab width — and
       * it doubles as the default tab: it is the only way back to the connection
       * list, which the first tab opened otherwise buries. It shares the strip's
       * row so the two sit on one rhythm, but not its scroll box, so it stays in
       * reach.
       */}
      <div className="mqs-tabrow">
        <button
          type="button"
          className="mqs-tab-home"
          aria-current={homeActive ? "page" : undefined}
          aria-label={t("shell.titleBar.homeLabel")}
          title={t("shell.titleBar.home")}
          onClick={onHome}
        >
          <AppLogo />
        </button>
        {tabs ?? <span style={{ flex: 1 }} />}
      </div>

      <Button
        variant="outline"
        size="sm"
        className={cn(
          "flex-none bg-background font-normal text-muted-foreground",
          dimmed && "text-(--c-disabled)",
        )}
        onClick={onSearch}
      >
        {t("shell.titleBar.search")}
      </Button>
      <IconBtn
        style={{ position: "relative" }}
        onClick={onRefresh}
        aria-busy={refreshing || undefined}
        title={t(refreshing ? "update.checking" : "shell.titleBar.checkUpdate")}
      >
        <RefreshCw
          className={cn(ICON_CLASS, spinning ? "mqs-refresh on" : "mqs-refresh")}
          onAnimationIteration={() => {
            if (!refreshing) setSpinning(false);
          }}
          aria-hidden
        />
        {updateReady && <Badge tone="var(--c-ok)" />}
      </IconBtn>
      <IconBtn onClick={onGithub} title={t("shell.titleBar.github")}>
        <SiGithub className="size-[1.08rem]" color="var(--c-github-mark)" aria-hidden />
      </IconBtn>
      <IconBtn
        style={{ position: "relative", ...(dimmed && { color: "var(--c-disabled)" }) }}
        onClick={onNotifications}
        title={
          notifications > 0
            ? t("shell.titleBar.notificationsUnread", { count: notifications })
            : t("shell.titleBar.notifications")
        }
      >
        <Bell className={ICON_CLASS} aria-hidden />
        {notifications > 0 && <Badge tone="var(--c-err)" />}
      </IconBtn>
      {/* 8b drops the strip entirely; with fewer than two tabs there is nothing to compare. */}
      {onSplit != null && (
        <IconBtn active={splitActive} onClick={onSplit} title={t("shell.titleBar.split")}>
          <Columns2 className={ICON_CLASS} aria-hidden />
        </IconBtn>
      )}
      <IconBtn onClick={onSettings} title={t("shell.titleBar.settings")}>
        <Settings className={ICON_CLASS} aria-hidden />
      </IconBtn>
      {!mac && <WindowControls />}
    </div>
  );
}
