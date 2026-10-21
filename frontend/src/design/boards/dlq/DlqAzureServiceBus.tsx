import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NOTICE_PANE, Notice } from "@/design/boards/BoardState";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, StatusBar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelFooter,
  DetailPanelHeader,
  JsonBlock,
  KV,
  PanelHeader,
  SectionLabel,
  toast,
  useConfirm,
} from "@/components";
import { useServiceBusDeadLetters } from "@/hooks/azureservicebus/useServiceBusDeadLetters";
import {
  deadLetterDescription,
  deadLetterReason,
  deadLetterSource,
  deliveryCount,
  senderProperties,
  sequenceNumber,
} from "@/mq/azureservicebus/messages";
import { count } from "@/design/boards/topics/EntitiesAzureServiceBus";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";
import type { MessageItem } from "@bindings/model/models";

const DASH = "—";
const READ_LIMIT = 100;

/**
 * Azure Service Bus dead letters.
 *
 * The left column is every queue and every subscription in the namespace, and
 * that is not a shortcut: each of them is created with a $DeadLetterQueue of
 * its own, so each of them has one whether or not it has ever failed a
 * message. There is no listing to fetch, because a $DeadLetterQueue is part of
 * its entity rather than an object in its own right.
 *
 * That is the whole difference from the two hosted families before this one.
 * SQS's and Pub/Sub's dead-letter pages walk the topology to find which
 * ordinary queue or topic something else points at, and both are empty on an
 * account that has configured no such policy. This page can only be empty when
 * the namespace is.
 *
 * Reading one is a peek and takes nothing, the way the messages page does.
 * Putting one back is not: it receives the message, sends a copy to the parent
 * entity, and completes the original, and the confirmation says so.
 */
export function DlqAzureServiceBus() {
  const { t } = useTranslation();
  const dead = useServiceBusDeadLetters();
  const confirm = useConfirm();
  const [chosen, setChosen] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [resending, setResending] = useState(false);

  const store = useMemo(
    () => dead.stores.find((row) => row.path === chosen) ?? null,
    [dead.stores, chosen],
  );
  const current = useMemo(
    () =>
      selected == null
        ? null
        : (dead.messages.find((message) => sequenceNumber(message) === selected) ?? null),
    [dead.messages, selected],
  );

  const open = (path: string) => {
    setChosen(path);
    setSelected(null);
    void dead.read(path, READ_LIMIT);
  };

  const putBack = async () => {
    if (store == null || current == null || resending) return;
    const sequence = sequenceNumber(current);
    if (sequence == null) return;
    const ok = await confirm({
      title: t("board.azure-servicebus.dlq.resendTitle", { sequence }),
      description: t("board.azure-servicebus.dlq.resendDesc", { entity: store.path }),
      confirmLabel: t("board.azure-servicebus.dlq.resend"),
    });
    if (!ok) return;
    setResending(true);
    try {
      await dead.resend(store.path, sequence);
      toast.success(t("board.azure-servicebus.dlq.resent", { sequence }));
      setSelected(null);
      await dead.refresh();
    } catch (resendError) {
      toast.error(t("board.azure-servicebus.dlq.resendFailed"), {
        description: formatErrorMessage(resendError),
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.azure-servicebus.dlq")}
        subtitle={t("board.azure-servicebus.dlq.subtitle")}
        actions={
          <RefreshButton
            refreshing={dead.loading}
            online
            onClick={() => void dead.refresh()}
          />
        }
      />
      <ListArea>
        <ListPane style={{ display: "flex", overflow: "hidden" }}>
          <div
            className="mqs-scroll w-[280px] flex-none border-r"
            style={dead.storesError != null ? NOTICE_PANE : undefined}
          >
            <PanelHeader title={t("board.azure-servicebus.dlq.stores")} />
            {dead.storesError != null ? (
              <Notice title={t("board.state.failed")} tone="var(--c-err)">
                {dead.storesError}
              </Notice>
            ) : (
              <Table inset="card">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.azure-servicebus.dlq.entity")}</TableHead>
                    <TableHead className="num">{t("board.azure-servicebus.dlq.held")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dead.stores.map((row) => (
                    <TableRow
                      key={row.path}
                      selected={chosen === row.path}
                      onClick={() => open(row.path)}
                    >
                      <TableCell className="select-text">{row.path}</TableCell>
                      <TableCell className="num">{count(row.count)}</TableCell>
                    </TableRow>
                  ))}
                  {dead.stores.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="py-8 text-center text-muted-foreground">
                        {t("board.azure-servicebus.dlq.noEntities")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>

          <div
            className="mqs-scroll min-w-0 flex-1"
            style={dead.error != null && !dead.reading ? NOTICE_PANE : undefined}
          >
            <PanelHeader
              title={
                store == null
                  ? t("board.azure-servicebus.dlq.pickOne")
                  : `${store.path}/$DeadLetterQueue`
              }
            />
            {dead.reading ? (
              <div className="p-6 text-center">
                <Spinner />
              </div>
            ) : dead.error != null ? (
              <Notice title={t("board.state.failed")} tone="var(--c-err)">
                {dead.error}
              </Notice>
            ) : (
              <Table inset="card">
                <TableHeader>
                  <TableRow>
                    <TableHead className="num">{t("board.azure-servicebus.dlq.sequence")}</TableHead>
                    <TableHead>{t("board.azure-servicebus.dlq.reason")}</TableHead>
                    <TableHead className="num">{t("board.azure-servicebus.dlq.deliveries")}</TableHead>
                    <TableHead>{t("board.azure-servicebus.dlq.enqueued")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dead.messages.map((message) => {
                    const sequence = sequenceNumber(message);
                    return (
                      <TableRow
                        key={sequence ?? message.messageId}
                        selected={selected != null && selected === sequence}
                        onClick={() => setSelected(sequence)}
                      >
                        <TableCell className="num mono3 select-text">{sequence ?? DASH}</TableCell>
                        <TableCell className="select-text">
                          {deadLetterReason(message) ?? DASH}
                        </TableCell>
                        <TableCell className="num">{deliveryCount(message) ?? DASH}</TableCell>
                        <TableCell>{formatMessageTime(message.storeTimestamp)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {dead.messages.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        {dead.searched
                          ? t("board.azure-servicebus.dlq.nothingGivenUp")
                          : t("board.azure-servicebus.dlq.startHere")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </ListPane>

        {current != null && (
          <DeadLetterSheet
            key={sequenceNumber(current) ?? current.messageId}
            message={current}
            resending={resending}
            onPutBack={() => void putBack()}
            onClose={() => setSelected(null)}
          />
        )}
      </ListArea>
      <StatusBar left={<span>{t("board.azure-servicebus.dlq.note")}</span>} />
    </Page>
  );
}

function DeadLetterSheet({
  message,
  resending,
  onPutBack,
  onClose,
}: {
  message: MessageItem;
  resending: boolean;
  onPutBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const properties = senderProperties(message);
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={String(sequenceNumber(message) ?? message.messageId)}
        onClose={onClose}
      />
      <DetailPanelBody>
        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.dlq.section.whyItStopped")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.azure-servicebus.dlq.reason"), deadLetterReason(message) ?? DASH],
              [
                t("board.azure-servicebus.dlq.description"),
                deadLetterDescription(message) ?? DASH,
              ],
              [
                t("board.azure-servicebus.dlq.deliveries"),
                deliveryCount(message) == null ? DASH : String(deliveryCount(message)),
              ],
              [
                t("board.azure-servicebus.dlq.enqueued"),
                formatMessageTime(message.storeTimestamp),
              ],
              [t("board.azure-servicebus.dlq.subject"), message.tags || DASH],
            ]}
          />
        </div>

        {/* Only set when the message arrived here by forwarding, and then it
            names where it actually failed - which is not the store it is
            sitting in. */}
        {deadLetterSource(message) != null && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.azure-servicebus.dlq.forwardedFrom", {
              source: deadLetterSource(message),
            })}
          </p>
        )}

        {properties.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">
              {t("board.azure-servicebus.dlq.section.properties")}
            </SectionLabel>
            <KV rows={properties} />
          </div>
        )}

        <div>
          <SectionLabel className="mb-1.5">{t("board.azure-servicebus.dlq.body")}</SectionLabel>
          <JsonBlock>{message.body}</JsonBlock>
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" disabled={resending} onClick={onPutBack}>
          {resending && <Spinner className="size-3.5" />}
          {t("board.azure-servicebus.dlq.resend")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
