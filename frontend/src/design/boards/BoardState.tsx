import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type { BrokerData } from "@/hooks/useBrokerData";
import { isI18nKey } from "@/lib/utils";

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
    return <Notice icon={<Spinner className="size-5" />} title={t("board.state.loading")} />;
  }
  if (state.error != null) {
    return (
      <Notice
        icon={<TriangleAlert size={22} aria-hidden />}
        title={t("board.state.failed")}
        tone="var(--c-err)"
        action={
          <Button variant="outline" size="xs" onClick={() => void state.refresh()}>
            {t("board.common.refresh")}
          </Button>
        }
      >
        {/* A driver reports a reason the user can act on as an i18n key, not a
            sentence, so that the words are chosen in their language here. */}
        {isI18nKey(state.error) ? t(state.error) : state.error}
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
    <Empty className="min-h-0 flex-1 gap-2 p-6">
      <EmptyHeader className="gap-2">
        {icon != null && (
          <EmptyMedia variant="default" style={{ color: tone ?? "var(--c-muted-2)" }}>
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle className="text-[12.5px]" style={{ color: tone }}>
          {title}
        </EmptyTitle>
        {children != null && (
          <EmptyDescription className="max-w-md text-xs leading-relaxed">
            {children}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {action != null && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
