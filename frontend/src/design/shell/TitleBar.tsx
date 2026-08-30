import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, RefreshCw, Settings } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { AppLogo } from "@/design/icons/AppLogo";
import { Button } from "@/components/ui/button";
import { Badge, ICON_CLASS, IconBtn } from "./IconBtn";
import { NotificationBell } from "./NotificationCenter";
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
export function TitleBar({
  tabs,
  homeActive,
  splitActive,
  dimmed = false,
  refreshing = false,
  updateReady = false,
  onHome,
  onSearch,
  onRefresh,
  onGithub,
  onOpenAlertSettings,
  onOpenConnection,
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
  onHome?: () => void;
  onSearch?: () => void;
  onRefresh?: () => void;
  onGithub?: () => void;
  /** The popover's footer link, into the thresholds that produce the alerts. */
  onOpenAlertSettings?: () => void;
  /** Where an alert row goes: the connection it fired on. */
  onOpenConnection?: (connectionId: number) => void;
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
      {/* Owns its own open state and unread count -- both come from the
          alert centre, which no longer has anything to tell the title bar. */}
      <NotificationBell
        dimmed={dimmed}
        onOpenAlertSettings={onOpenAlertSettings}
        onOpenConnection={onOpenConnection}
      />
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
