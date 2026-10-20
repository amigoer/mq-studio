import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { motion, useIsPresent } from "motion/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

/*
 * Controls that own their click. Without this, hitting 刷新 or a filter in the
 * toolbar would dismiss the panel you are reading, which is not what "click the
 * blank area" means.
 */
const INTERACTIVE =
  'button, a, input, textarea, select, label, [role="tab"], [role="switch"], [role="menuitem"], [role="option"], [role="checkbox"], [role="combobox"], [role="dialog"], [data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"]';

/*
 * Regions beside the page rather than in it - the assistant's dock. What a
 * person does there, Esc in its composer included, is not about the panel.
 */
export const BESIDE_THE_PAGE = "data-beside-page";
const beside = (target: EventTarget | null) =>
  target instanceof Element && target.closest(`[${BESIDE_THE_PAGE}]`) != null;

/**
 * The docked master-detail inspector. Deliberately not the modal shadcn Sheet:
 * it must stay non-modal so clicking another row retargets the panel instead
 * of first dismissing an overlay. It is positioned against its `ListArea`,
 * beside the rows, and leaves through the `AnimatePresence` there: hosts
 * render it behind `selected &&`.
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
  const present = useIsPresent();

  /*
   * Tells the list beside the sheet how much room to give up (`.mqs-listpane`
   * reads it), so the sheet sits next to the rows instead of over their last
   * columns. Set before paint and given back as the sheet starts to leave, so
   * the list slides back while the sheet slides out.
   */
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (parent == null || !present) return;
    parent.style.setProperty("--mqs-sheet-w", `${width}px`);
    return () => {
      parent.style.removeProperty("--mqs-sheet-w");
    };
  }, [width, present]);

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
      if (beside(target)) return;
      dismiss.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !beside(event.target)) dismiss.current?.();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <motion.div
      ref={ref}
      className={cn(
        /* Two tight layers rather than one 44px blur, which laid a grey band a
           finger wide across whatever list the sheet was describing. */
        "absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l bg-background shadow-[-10px_0_28px_-14px_rgba(0,0,0,0.22),-24px_0_48px_-24px_rgba(0,0,0,0.08)]",
        className,
      )}
      /*
       * The whole way in from the edge it is docked to: a short nudge across
       * the panel's width reads as appearing rather than arriving. The fade
       * keeps the shadow's tail from reaching the edge before the panel does.
       */
      initial={{ x: "100%", opacity: 0 }}
      animate={{
        x: 0,
        opacity: 1,
        transition: {
          x: { duration: DURATION.slow, ease: EASE.standard },
          opacity: { duration: DURATION.fast, ease: "linear" },
        },
      }}
      exit={{ x: "100%", opacity: 0, transition: { duration: DURATION.base, ease: EASE.in } }}
      inert={!present}
      style={{ width: `${width}px`, ...style }}
    >
      {children}
    </motion.div>
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
    <div className="px-5 pt-4">
      <div className="flex min-h-7 items-center gap-2">
        {/* Selectable, since the title is a name somebody copies, but in the
            UI face: a monospaced headline shouted over the sheet it heads. */}
        <b className="min-w-0 cursor-text truncate text-[15px] font-semibold tracking-[-0.01em] select-text">
          {title}
        </b>
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
        <Tabs value={activeTab} onValueChange={(tab) => onTabChange?.(tab)} className="mt-2.5">
          <TabsList variant="line" className="w-full justify-start gap-3 border-b">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="flex-none px-0.5 font-normal data-active:font-medium after:bg-(--c-primary)"
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
      <div className={cn("flex flex-col gap-4 px-5 py-4", className)} style={style}>
        {children}
      </div>
    </ScrollArea>
  );
}

export function DetailPanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 border-t bg-(--c-panel) px-5 py-3">{children}</div>;
}
