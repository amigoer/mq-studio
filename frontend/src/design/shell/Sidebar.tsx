import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PROTOCOLS, type PageId, type ProtocolId } from "@/design/data/protocols";
import { useCapabilities } from "@/mq/capabilities";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { navAvailability } from "@/mq/navigation";
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
 *
 * What it draws is the connection's answer, not the protocol's page list. An
 * endpoint that cannot do something and says why gets a disabled entry
 * carrying that reason; one whose family has no such concept gets no entry,
 * and a group left with none disappears with it.
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
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const { online } = useConnectionScope();
  const nav = navAvailability(capabilities, online);

  return (
    <nav className={cn("side3", collapsed && "side3--rail")}>
      {PROTOCOLS[protocol].nav.map((group, gi) => {
        const items = group.items.filter(({ id }) => nav.visible(id));
        if (items.length === 0) return null;
        return (
          <Fragment key={group.label ?? `g${gi}`}>
            {group.label != null && <div className="gl">{t(group.label)}</div>}
            {items.map(({ id, icon: Icon, label }) => {
              const disabled = nav.disabled(id);
              const reason = disabled ? nav.reason(id) : undefined;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  aria-current={id === active ? "page" : undefined}
                  className={cn("ni", id === active && "on")}
                  /* The label is the only thing naming the icon once it is
                     gone; a blocked entry adds why it cannot be opened. */
                  title={[collapsed ? t(label) : null, reason].filter(Boolean).join(" · ") || undefined}
                  onClick={() => onSelect?.(id)}
                >
                  <span className="nic">
                    <Icon size={ICON} aria-hidden />
                  </span>
                  <span className="nil">{t(label)}</span>
                </button>
              );
            })}
          </Fragment>
        );
      })}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="ni side3-toggle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
        title={collapsed ? t("shell.sidebar.expandTitle") : t("shell.sidebar.collapseTitle")}
        onClick={onToggle}
      >
        <span className="nic">
          {collapsed ? <PanelLeftOpen size={ICON} aria-hidden /> : <PanelLeftClose size={ICON} aria-hidden />}
        </span>
        <span className="nil">{t("shell.sidebar.collapseItem")}</span>
      </button>
    </nav>
  );
}
