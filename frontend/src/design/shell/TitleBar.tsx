import type { ReactNode } from "react";
import { SiGithub } from "react-icons/si";
import { AppLogo } from "@/design/icons/AppLogo";
import { IconBtn } from "@/design/ui";
import { isMac } from "@/api/platform";
import { WindowControls } from "./WindowControls";

/**
 * `.tb2` from the canvas, carrying the connection tabs inline. The canvas draws
 * tabs on their own 39px strip below; merging the two rows buys that height
 * back for content at the cost of horizontal room for tabs, which is why the
 * strip scrolls and 分屏对照 moved into the icon cluster as ⊞.
 *
 * The canvas drew the macOS traffic lights by hand; the real window has the
 * native ones (main.go keeps the frame on darwin and moves the buttons onto
 * this bar), so the row only reserves the width they take. Everywhere else the
 * window is frameless and the bar ends with its own window buttons.
 */
export function TitleBar({
  tabs,
  connectionsActive,
  splitActive,
  dimmed = false,
  updateReady = false,
  onSearch,
  onConnections,
  onRefresh,
  onGithub,
  onNotifications,
  onSettings,
  onSplit,
}: {
  tabs?: ReactNode;
  connectionsActive?: boolean;
  splitActive?: boolean;
  /** 8b: with no connections the search and notification affordances read as inert. */
  dimmed?: boolean;
  updateReady?: boolean;
  onSearch?: () => void;
  onConnections?: () => void;
  onRefresh?: () => void;
  onGithub?: () => void;
  onNotifications?: () => void;
  onSettings?: () => void;
  onSplit?: () => void;
}) {
  const mac = isMac();

  return (
    <div
      className={mac ? "tb2 tb2--mac" : "tb2"}
      style={{ background: "#fafafa" }}
    >
      {/* Mark only — the wordmark it sat next to was traded for tab width. */}
      <span
        role="img"
        aria-label="MQ Studio"
        title="MQ Studio"
        /* The glyph is inset inside its 140x96 box, so these read ~2px wider. */
        style={{ display: "flex", alignItems: "center", flex: "none", margin: "0 6px 0 4px" }}
      >
        <AppLogo />
      </span>

      {tabs ?? <span style={{ flex: 1 }} />}

      <button
        type="button"
        className="in3"
        style={{ background: "#fff", color: dimmed ? "#c9c9c9" : undefined, flex: "none" }}
        onClick={onSearch}
      >
        搜索 ⌘K
      </button>
      <IconBtn active={connectionsActive} onClick={onConnections} title="连接">
        ⇄
      </IconBtn>
      <IconBtn style={{ position: "relative" }} onClick={onRefresh} title="检查更新">
        ↻
        {updateReady && (
          <span
            style={{
              position: "absolute",
              top: "4px",
              right: "4px",
              width: "6px",
              height: "6px",
              borderRadius: "99px",
              background: "#29915d",
            }}
          />
        )}
      </IconBtn>
      <IconBtn onClick={onGithub} title="GitHub">
        <SiGithub size={13} color="#181717" aria-hidden />
      </IconBtn>
      <IconBtn
        style={dimmed ? { color: "#c9c9c9" } : undefined}
        onClick={onNotifications}
        title="通知"
      >
        ◔
      </IconBtn>
      {/* 8b drops the strip entirely; with fewer than two tabs there is nothing to compare. */}
      {onSplit != null && (
        <IconBtn active={splitActive} onClick={onSplit} title="分屏对照">
          ⊞
        </IconBtn>
      )}
      <IconBtn onClick={onSettings} title="设置">
        ⚙
      </IconBtn>
      {!mac && <WindowControls />}
    </div>
  );
}
