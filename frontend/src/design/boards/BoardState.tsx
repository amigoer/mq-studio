import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { Btn } from "@/design/ui";
import type { BrokerData } from "@/hooks/useBrokerData";

/**
 * The three states every data board reaches before it has rows.
 *
 * They are one component because the distinction is what matters and is easy
 * to lose: nothing dialled, dialled but the request failed, and dialled with
 * genuinely nothing there. Rendering all three as an empty table is how a
 * broken connection reads as an empty cluster.
 */
export function BoardState({
  state,
  empty,
  children,
}: {
  state: Pick<BrokerData<unknown>, "loading" | "error" | "online" | "refresh">;
  /** Shown when the request succeeded and returned nothing. */
  empty?: ReactNode;
  /** Rendered once there is something to show. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();

  if (!state.online) {
    return (
      <Notice icon={<Unplug size={22} aria-hidden />} title={t("board.state.offline")}>
        {t("board.state.offlineHint")}
      </Notice>
    );
  }
  if (state.loading) {
    return (
      <Notice
        icon={<RefreshCw size={22} className="mqs-turning" aria-hidden />}
        title={t("board.state.loading")}
      />
    );
  }
  if (state.error != null) {
    return (
      <Notice
        icon={<TriangleAlert size={22} aria-hidden />}
        title={t("board.state.failed")}
        tone="var(--c-err)"
        action={
          <Btn size="row" onClick={() => void state.refresh()}>
            {t("board.common.refresh")}
          </Btn>
        }
      >
        {state.error}
      </Notice>
    );
  }
  return <>{empty ?? children}</>;
}

/** Whether BoardState will draw over the board instead of its content. */
export function isBlocked(
  state: Pick<BrokerData<unknown>, "loading" | "error" | "online">,
): boolean {
  return !state.online || state.loading || state.error != null;
}

export function Notice({
  icon,
  title,
  tone,
  action,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  tone?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "9px",
        padding: "40px 24px",
        textAlign: "center",
        color: "var(--c-muted)",
      }}
    >
      <span style={{ color: tone ?? "var(--c-muted-2)" }}>{icon}</span>
      <b style={{ fontSize: "12.5px", color: tone ?? "var(--c-fg)" }}>{title}</b>
      {children != null && (
        <span style={{ fontSize: "11.5px", maxWidth: "460px", lineHeight: 1.6 }}>{children}</span>
      )}
      {action}
    </div>
  );
}
