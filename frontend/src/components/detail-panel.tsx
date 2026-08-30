import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEnter } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
 * Controls that own their click. Without this, hitting 刷新 or a filter in the
 * toolbar would dismiss the panel you are reading, which is not what "click the
 * blank area" means.
 */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="tab"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="combobox"], [role="dialog"], [data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"]';

/**
 * The docked master-detail inspector. Deliberately not the modal shadcn Sheet:
 * it must stay non-modal so clicking another row retargets the panel instead
 * of first dismissing an overlay. It is absolutely positioned against the
 * shell body, so it overlays the page header too rather than squeezing the
 * table's column widths.
 */
export function DetailPanel({
  width = 380,
  onDismiss,
  children,
  className,
  style,
}: {
  width?: number;
  /**
   * Clicking the blank area closes the panel, the way a master-detail list is
   * expected to behave. Clicking another row is not a dismissal — the row
   * handler has already retargeted the panel by the time this runs, so rows
   * are skipped rather than closing and reopening.
   */
  onDismiss?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useEnter();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    // Bubble phase on the document, so React's root handler has already run.
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target == null || !target.isConnected) return;
      if (ref.current?.contains(target)) return;
      if (target.closest("tbody tr") != null) return;
      if (target.closest(INTERACTIVE) != null) return;
      dismiss.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current?.();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "mqs-slide-right absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l bg-background shadow-[-16px_0_44px_rgba(0,0,0,0.13)]",
        className,
      )}
      data-state={state}
      style={{ width: `${width}px`, ...style }}
    >
      {children}
    </div>
  );
}

export function DetailPanelHeader({
  title,
  badge,
  tabs,
  activeTab,
  onTabChange,
  onClose,
}: {
  title: ReactNode;
  badge?: ReactNode;
  /* Identified rather than labelled: the label is a translation and cannot be
     what the selected tab is compared against. */
  tabs?: readonly { id: string; label: ReactNode }[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-4 pt-3">
      <div className="flex items-center gap-2">
        <b className="mono3 text-base font-semibold">{title}</b>
        {badge}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("common.close")}
          className="text-muted-foreground"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {tabs != null && (
        <Tabs value={activeTab} onValueChange={(tab) => onTabChange?.(tab)} className="mt-1.5">
          <TabsList variant="line" className="h-auto gap-3.5 border-b p-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={cn(
                  /*
                   * `after:hidden` is load-bearing. The `line` variant already
                   * draws its own active bar as an ::after at bottom -5px, so
                   * adding an underline here as well produced two rules: one
                   * flush on the strip's baseline and one floating five pixels
                   * under it, with the strip's own border in between.
                   *
                   * The border is the one kept, because a tab underline should
                   * sit on the strip's baseline rather than hover below it.
                   */
                  "rounded-none border-0 border-b-2 border-transparent px-0.5 pt-0 pb-1.5 text-sm font-normal text-muted-foreground after:hidden",
                  "data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none",
                )}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
    </div>
  );
}

export function DetailPanelBody({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn("flex flex-col gap-3 px-4 py-3", className)} style={style}>
        {children}
      </div>
    </ScrollArea>
  );
}

export function DetailPanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 border-t bg-background px-4 py-3">{children}</div>;
}
