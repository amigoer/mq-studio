import { PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/EmptyState";

/** The "no cluster connected" case — an EmptyState with the copy filled in. */
export function OfflineEmpty({
  message,
  actionLabel,
  onAction,
  className,
}: {
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={PlugZap}
      title={message ?? t("common.connectFirst")}
      actionLabel={actionLabel ?? t("common.goToConnections")}
      onAction={onAction}
      className={className}
    />
  );
}
