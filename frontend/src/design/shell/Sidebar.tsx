import { Fragment } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PROTOCOLS, type PageId, type ProtocolId } from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/*
 * The icons ink 13.3px of their 16px box against a 12.5px label -- the ratio a
 * sidebar reads best at, and the one the canvas's Unicode symbols could not
 * hold: they inked anywhere from 4.7px to 9.1px depending on the glyph.
 */
const ICON = 16;

/**
 * `.side3` — 198px rail, grouped by 浏览 / 运维, labelled per protocol.
 *
 * The canvas drew no collapsed state. It collapses to an icon rail rather than
 * to nothing, because the sidebar *is* the page navigation: hiding it outright
 * would leave a tab with no way to change page. Which page each tab is on is
 * per-tab state (5c); whether the rail is collapsed is not — it is window
 * chrome, and one tab's width should not change under another.
 */
export function Sidebar({
  protocol,
  active,
  collapsed = false,
  onSelect,
  onToggle,
}: {
  protocol: ProtocolId;
  active: PageId;
  collapsed?: boolean;
  onSelect?: (page: PageId) => void;
  onToggle?: () => void;
}) {
  return (
    <nav className={cn("side3", collapsed && "side3--rail")}>
      {PROTOCOLS[protocol].nav.map((group, gi) => (
        <Fragment key={group.label ?? `g${gi}`}>
          {group.label != null && <div className="gl">{group.label}</div>}
          {group.items.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              aria-current={id === active ? "page" : undefined}
              className={cn("ni", id === active && "on")}
              /* The label is the only thing naming the icon once it is gone. */
              title={collapsed ? label : undefined}
              onClick={() => onSelect?.(id)}
            >
              <span className="nic">
                <Icon size={ICON} aria-hidden />
              </span>
              <span className="nil">{label}</span>
            </button>
          ))}
        </Fragment>
      ))}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="ni side3-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
        title={`${collapsed ? "展开" : "收起"}侧边栏 ⌘B`}
        onClick={onToggle}
      >
        <span className="nic">
          {collapsed ? <PanelLeftOpen size={ICON} aria-hidden /> : <PanelLeftClose size={ICON} aria-hidden />}
        </span>
        <span className="nil">收起</span>
      </button>
    </nav>
  );
}
