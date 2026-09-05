import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  PROTOCOLS,
  type PageId,
  type ProtocolId,
} from "@/design/data/protocols";
import { useCapabilities } from "@/mq/capabilities";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { navAvailability } from "@/mq/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ScopeSwitcher } from "./ScopeSwitcher";

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
  scope = "",
  switchingScope = false,
  onSelect,
  onToggle,
  onSwitchScope,
}: {
  protocol: ProtocolId;
  active: PageId;
  collapsed?: boolean;
  /** What the connection is scoped to, for the families that carry one. */
  scope?: string;
  /** True while a scope switch is redialling. */
  switchingScope?: boolean;
  onSelect?: (page: PageId) => void;
  onToggle?: () => void;
  onSwitchScope?: (next: string) => void;
}) {
  const { t } = useTranslation();
  const capabilities = useCapabilities();
  const { online } = useConnectionScope();
  const nav = navAvailability(capabilities, online);

  return (
    // delayDuration 0 is the primitive's default and wrong for a rail the
    // pointer crosses on its way somewhere else: every entry would flash a
    // tooltip. Half a second is long enough to mean the pointer stopped.
    <TooltipProvider delayDuration={500}>
      <nav className={cn("side3", collapsed && "side3--rail")}>
        {/* Above the pages because it scopes all of them: a RocketMQ namespace
            is a prefix on every name the connection sends, so switching it
            re-points the whole tab rather than filtering one board. Draws
            itself only where the connection has such a scope. */}
        {onSwitchScope != null && (
          <ScopeSwitcher scope={scope} switching={switchingScope} onSwitch={onSwitchScope} />
        )}
        {PROTOCOLS[protocol].nav.map((group, gi) => {
          const items = group.items.filter(({ id }) => nav.visible(id));
          if (items.length === 0) return null;
          return (
            <Fragment key={group.label ?? `g${gi}`}>
              {group.label != null && (
                <div className="gl">{t(group.label)}</div>
              )}
              {items.map(({ id, icon: Icon, label }) => {
                const disabled = nav.disabled(id);
                const reason = disabled ? nav.reason(id) : undefined;
                /*
                 * The tooltip is a component rather than the title attribute.
                 *
                 * WKWebView, which is what this app renders in, does not show
                 * HTML title tooltips at all - so the reason a page is blocked
                 * was computed, translated, and then invisible in every build.
                 * The attribute stays for assistive technology and for anything
                 * reading the markup; what a person sees is this.
                 */
                const hint = [
                  collapsed ? t(label) : null,
                  reason == null ? null : t(reason),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const entry = (
                  <button
                    key={id}
                    type="button"
                    /* aria-disabled rather than disabled, because the reason
                     below is the whole point of keeping the entry: a disabled
                     button receives no pointer events, so its title tooltip
                     never appears and the explanation is computed, translated
                     and then invisible. The click is guarded instead. */
                    aria-disabled={disabled || undefined}
                    aria-current={id === active ? "page" : undefined}
                    className={cn("ni", id === active && "on")}
                    /* The label is the only thing naming the icon once it is
                     gone; a blocked entry adds why it cannot be opened. The
                     reason is a translation key - drivers report keys, not
                     sentences - and it was going into the tooltip raw, so a
                     degraded entry explained itself as
                     "mq.kafka.degraded.accessControl". */
                    title={hint || undefined}
                    onClick={() => {
                      if (disabled) return;
                      onSelect?.(id);
                    }}
                  >
                    <span className="nic">
                      <Icon size={ICON} aria-hidden />
                    </span>
                    <span className="nil">{t(label)}</span>
                  </button>
                );

                if (hint === "") return entry;
                return (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>{entry}</TooltipTrigger>
                    {/* A degraded reason is a couple of sentences, not a label:
                      without a width it runs off the side of the window. */}
                  <TooltipContent
                    side="right"
                    className="max-w-80 text-xs leading-relaxed whitespace-normal"
                  >
                    {hint}
                  </TooltipContent>
                  </Tooltip>
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
          aria-label={
            collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")
          }
          title={
            collapsed
              ? t("shell.sidebar.expandTitle")
              : t("shell.sidebar.collapseTitle")
          }
          onClick={onToggle}
        >
          <span className="nic">
            {collapsed ? (
              <PanelLeftOpen size={ICON} aria-hidden />
            ) : (
              <PanelLeftClose size={ICON} aria-hidden />
            )}
          </span>
          <span className="nil">{t("shell.sidebar.collapseItem")}</span>
        </button>
      </nav>
    </TooltipProvider>
  );
}
