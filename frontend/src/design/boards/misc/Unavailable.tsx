import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldOff } from "lucide-react";
import { Page, PageHeader } from "@/design/shell/Page";
import { Notice } from "@/design/boards/BoardState";
import { useCapabilities } from "@/mq/capabilities";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { navAvailability } from "@/mq/navigation";
import { isI18nKey } from "@/lib/utils";

/**
 * What a page opens on when the connection cannot answer it.
 *
 * The endpoint said why - a cluster running no authorizer, a plugin nobody
 * installed, a tier that cannot be reached - and that sentence is the whole
 * point of letting the entry be clicked. Drivers report it as a translation
 * key so that one Go driver's answer reads in both languages; one that is not
 * a key is passed through as written.
 */
export function Unavailable({ labelKey, reason }: { labelKey: string; reason: string }) {
  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t(labelKey)} />
      <Notice icon={<ShieldOff size={22} aria-hidden />} title={t("board.unavailable.title")}>
        {isI18nKey(reason) ? t(reason) : reason}
      </Notice>
    </Page>
  );
}

/**
 * The board, or the reason there is none to draw.
 *
 * Boards that know the limit draw it better themselves - Kafka's ACL page
 * keeps its tabs and explains which system is off - and they still do: this
 * stands in only where every capability the page asks for came back degraded,
 * which is exactly when the board behind it would otherwise report a failed
 * read for something that is not a failure.
 */
export function PageGate({
  page,
  labelKey,
  children,
}: {
  page: string;
  labelKey: string;
  children: ReactNode;
}): ReactNode {
  const capabilities = useCapabilities();
  const { online } = useConnectionScope();
  const nav = navAvailability(capabilities, online);

  const reason = nav.disabled(page) ? nav.reason(page) : undefined;
  if (reason == null) return children;
  return <Unavailable labelKey={labelKey} reason={reason} />;
}
