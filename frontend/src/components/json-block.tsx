import type { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The message-body card: a bordered, monospaced, lightly tinted JSON block. */
export function JsonBlock({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Card
      className={cn(
        "mono3 block gap-0 rounded-xl px-3 py-2.5 text-xs leading-[1.7] whitespace-pre-wrap text-(--c-fg-2) shadow-none",
        className,
      )}
      style={style}
    >
      {children}
    </Card>
  );
}

/** Two-space JSON indent, as rendered pre-formatted. */
export const IND = "  ";

export const JStr = ({ children }: { children: ReactNode }) => (
  <span className="text-(--c-ok-text)">{children}</span>
);
export const JNum = ({ children }: { children: ReactNode }) => (
  <span className="text-(--c-info-text)">{children}</span>
);
export const JDim = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

export type TraceStep = {
  title: ReactNode;
  meta: ReactNode;
  /** Bullet colour; defaults to the ok green. */
  color?: string;
  extra?: ReactNode;
};

/** The consumption trace — a bullet-and-rail vertical timeline. */
export function Timeline({ steps }: { steps: readonly TraceStep[] }) {
  return (
    <div className="flex flex-col">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 size-2 flex-none rounded-full"
                style={{ background: step.color ?? "var(--c-ok)" }}
              />
              {!last && <span className="w-px flex-1 bg-(--c-border-soft)" />}
            </div>
            <div className={cn("text-xs", !last && "pb-2.5")}>
              <b className="font-medium">{step.title}</b>{" "}
              <span className="mono3 text-[10.5px] text-muted-foreground">{step.meta}</span>
              {step.extra != null && <> {step.extra}</>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
