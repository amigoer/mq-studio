import { useState, type ReactNode } from "react";
import { Bell, Columns2, RefreshCw, Settings } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { AppLogo } from "@/design/icons/AppLogo";
import { IconBtn } from "@/design/ui";
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
 * filled brand mark reads as one row. The canvas used Unicode symbols here, but
 * their design sizes are unrelated -- ⚙ inked little more than half of ↻ at the
 * same font-size -- and off darwin they fall back to whatever the system has.
 */
const ICON = 17;

export function TitleBar({
  tabs,
  homeActive,
  splitActive,
  dimmed = false,
  updateReady = false,
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
  updateReady?: boolean;
  onHome?: () => void;
  onSearch?: () => void;
  onRefresh?: () => void;
  onGithub?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onSplit?: () => void;
}) {
  const mac = isMac();
  /*
   * The update icon turns one full circle per click. Counting turns instead of
   * toggling an animation class lets a click landing mid-turn carry the icon on
   * from where it is, with no jump back to zero.
   */
  const [turns, setTurns] = useState(0);

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
          aria-label="MQ Studio 首页"
          title="首页"
          onClick={onHome}
        >
          <AppLogo />
        </button>
        {tabs ?? <span style={{ flex: 1 }} />}
      </div>

      <button
        type="button"
        className="in3"
        style={{ background: "var(--c-bg)", color: dimmed ? "var(--c-disabled)" : undefined, flex: "none" }}
        onClick={onSearch}
      >
        搜索 ⌘K
      </button>
      <IconBtn
        style={{ position: "relative" }}
        onClick={() => {
          setTurns((n) => n + 1);
          onRefresh?.();
        }}
        title="检查更新"
      >
        <RefreshCw
          size={ICON}
          className="mqs-refresh"
          style={{ transform: `rotate(${turns * 360}deg)` }}
          aria-hidden
        />
        {updateReady && (
          <span
            style={{
              position: "absolute",
              top: "3px",
              right: "3px",
              width: "6px",
              height: "6px",
              borderRadius: "99px",
              background: "var(--c-ok)",
              /* The badge sits over the icon's corner, so it needs an edge. */
              boxShadow: "0 0 0 1.5px var(--c-bg)",
            }}
          />
        )}
      </IconBtn>
      <IconBtn onClick={onGithub} title="GitHub">
        <SiGithub size={14} color="var(--c-github-mark)" aria-hidden />
      </IconBtn>
      <IconBtn
        style={dimmed ? { color: "var(--c-disabled)" } : undefined}
        onClick={onNotifications}
        title="通知"
      >
        <Bell size={ICON} aria-hidden />
      </IconBtn>
      {/* 8b drops the strip entirely; with fewer than two tabs there is nothing to compare. */}
      {onSplit != null && (
        <IconBtn active={splitActive} onClick={onSplit} title="分屏对照">
          <Columns2 size={ICON} aria-hidden />
        </IconBtn>
      )}
      <IconBtn onClick={onSettings} title="设置">
        <Settings size={ICON} aria-hidden />
      </IconBtn>
      {!mac && <WindowControls />}
    </div>
  );
}
