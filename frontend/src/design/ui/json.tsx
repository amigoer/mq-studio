import type { CSSProperties, ReactNode } from "react";
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
    <div
      className={cn("card3", "mono3", className)}
      style={{
        padding: "10px 12px",
        fontSize: "11px",
        lineHeight: 1.7,
        color: "#525252",
        background: "#fff",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Two-space JSON indent, as the canvas renders it with `&nbsp;`. */
export const IND = "  ";

export const JStr = ({ children }: { children: ReactNode }) => (
  <span style={{ color: "#1f7a4d" }}>{children}</span>
);
export const JNum = ({ children }: { children: ReactNode }) => (
  <span style={{ color: "#0369a1" }}>{children}</span>
);
export const JDim = ({ children }: { children: ReactNode }) => (
  <span style={{ color: "#8a8a8a" }}>{children}</span>
);

export type TraceStep = {
  title: ReactNode;
  meta: ReactNode;
  /** Bullet colour; the canvas uses green, grey and amber. */
  color?: string;
  extra?: ReactNode;
};

/** The consumption trace in 3d — a bullet-and-rail vertical timeline. */
export function Timeline({ steps }: { steps: readonly TraceStep[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: "10px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span className="dotg" style={{ marginTop: "4px", background: step.color }} />
              {!last && <span style={{ width: "1px", flex: 1, background: "#e4e4e7" }} />}
            </div>
            <div style={{ paddingBottom: last ? undefined : "10px", fontSize: "11.5px" }}>
              <b style={{ fontWeight: 500 }}>{step.title}</b>{" "}
              <span className="mono3" style={{ color: "#8a8a8a", fontSize: "10.5px" }}>
                {step.meta}
              </span>
              {step.extra != null && <> {step.extra}</>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
