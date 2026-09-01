import { useState } from "react";
import { useTranslation } from "react-i18next";
import { History, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  DetailPanelHeader,
  KV,
  MiniStat,
  OutlineTag,
  Panel,
  SectionLabel,
  Status,
  WarnBanner,
  toast,
  useConfirm,
} from "@/components";
import { ListArea, ListPane, Page, PageHeader, RefreshButton } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import {
  usePulsarSubscriptionDetail,
  usePulsarSubscriptions,
} from "@/hooks/pulsar/usePulsarSubscriptions";
import { usePulsarTopics } from "@/hooks/pulsar/usePulsarTopics";
import * as pulsarApi from "@/api/pulsar";
import { resetOffset } from "@/api/consumer";
import {
  activeConsumer,
  backlogBytes,
  delayedCount,
  isBlocked,
  isDurable,
  redeliverRate,
  shortTopicOf,
  subscriptionType,
  topicOf,
  unackedCount,
} from "@/mq/pulsar/subscriptions";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import {
  SubscriptionDialogPulsar,
  type PulsarSubscriptionForm,
} from "./SubscriptionDialogPulsar";
import { ResetCursorDialogPulsar } from "./ResetCursorDialogPulsar";

const R = { textAlign: "right" } as const;

/** A figure the driver did not report, drawn as absent rather than as zero. */
function shown(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 13b — Pulsar subscriptions.
 *
 * A Pulsar subscription is a cursor the broker stores against one topic, and
 * that shapes the whole page. It is named only within its topic, so every row
 * carries both and every action sends both. It exists whether or not anything
 * is connected, which is why an idle subscription is a normal state here
 * rather than a group that has gone away. And its type is chosen by the
 * consumers that attach, so the column is reported and there is no edit.
 *
 * Blocked is the state worth its own colour. Past the unacked limit the broker
 * stops delivering entirely; from the backlog alone that is indistinguishable
 * from a slow consumer, and the two are fixed in different places.
 */
export function SubscriptionsPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const state = usePulsarSubscriptions();
  const [selected, setSelected] = useState<{ topic: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);

  const subscriptions = state.data ?? [];
  const current =
    subscriptions.find(
      (row) => selected != null && topicOf(row) === selected.topic && row.ref.name === selected.name,
    ) ?? null;
  const detail = usePulsarSubscriptionDetail(selected?.topic ?? null, selected?.name ?? null);

  // The topic picker for a create. Read only while the dialog is open, since
  // it is the one call this page does not otherwise need.
  const topics = usePulsarTopics("");
  const topicURLs = (topics.data ?? []).map((topic) =>
    `${topic.attributes?.["pulsarPersistent"] === "false" ? "non-persistent" : "persistent"}://${topic.ref.namespace}/${topic.ref.name}`,
  );

  const blocked = subscriptions.filter(isBlocked).length;

  const create = async (form: PulsarSubscriptionForm) => {
    await pulsarApi.createPulsarSubscription(connID, form.topic, form.name, form.startAt);
    await state.refresh();
    toast.success(t("board.consumers.pulsar.created", { name: form.name }));
  };

  const remove = async (topic: string, name: string) => {
    const ok = await confirm({
      title: t("board.consumers.pulsar.deleteTitle"),
      description: t("board.consumers.pulsar.deleteBody", { name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await pulsarApi.removePulsarSubscription(connID, topic, name);
      setSelected(null);
      await state.refresh();
      toast.success(t("board.consumers.pulsar.deleted", { name }));
    } catch (failure) {
      // Pulsar refuses while a consumer is attached, which is the thing the
      // operator has to deal with before the delete can work.
      toast.error(formatErrorMessage(failure));
    }
  };

  const reset = async (timestamp: number, force: boolean) => {
    if (current == null) return;
    await resetOffset(connID, current.ref.name, topicOf(current), timestamp, force);
    await state.refresh();
    await detail.refresh();
    toast.success(t("board.consumers.pulsar.cursorMoved", { name: current.ref.name }));
  };

  return (
    <Page>
      <PageHeader
        title={t("board.consumers.pulsar.title")}
        actions={
          <>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!state.online}>
              <Plus size={14} aria-hidden />
              {t("board.consumers.pulsar.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </>
        }
      />
      <BoardState state={state}>
        <ListArea>
          <ListPane>
            {blocked > 0 && (
              <WarnBanner>{t("board.consumers.pulsar.blockedBanner", { count: blocked })}</WarnBanner>
            )}
            <Panel>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.consumers.pulsar.subscription")}</TableHead>
                    <TableHead>{t("board.consumers.pulsar.topic")}</TableHead>
                    <TableHead>{t("board.consumers.pulsar.type")}</TableHead>
                    <TableHead>{t("board.consumers.pulsar.state")}</TableHead>
                    <TableHead style={R}>{t("board.consumers.pulsar.consumers")}</TableHead>
                    <TableHead style={R}>{t("board.consumers.pulsar.backlog")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((row) => (
                    <TableRow
                      key={`${topicOf(row)}/${row.ref.name}`}
                      data-state={
                        selected != null &&
                        selected.topic === topicOf(row) &&
                        selected.name === row.ref.name
                          ? "selected"
                          : undefined
                      }
                      onClick={() => setSelected({ topic: topicOf(row), name: row.ref.name })}
                    >
                      <TableCell className="mono3">{row.ref.name}</TableCell>
                      <TableCell className="mono3">{shortTopicOf(row)}</TableCell>
                      <TableCell>
                        <OutlineTag>{subscriptionType(row) || "—"}</OutlineTag>
                      </TableCell>
                      <TableCell>
                        {isBlocked(row) ? (
                          /* Not a deep backlog: the broker has stopped
                             delivering entirely, and that is fixed by
                             acknowledging or raising a limit rather than by
                             looking at the consumer. */
                          <Status tone="warn">{t("board.consumers.pulsar.blocked")}</Status>
                        ) : row.members > 0 ? (
                          <Status tone="ok" dot>
                            {t("board.consumers.pulsar.reading")}
                          </Status>
                        ) : (
                          /* A subscription with nothing attached is normal on
                             this family: it is a stored cursor, not a group
                             that appeared because a consumer connected. */
                          <Status tone="off">{t("board.consumers.pulsar.idle")}</Status>
                        )}
                      </TableCell>
                      <TableCell style={R}>{row.members}</TableCell>
                      <TableCell style={R}>{shown(row.backlog < 0 ? null : Number(row.backlog))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </ListPane>

          {current != null && (
            <DetailPanel>
              <DetailPanelHeader
                title={current.ref.name}
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                {isBlocked(current) && (
                  <WarnBanner>{t("board.consumers.pulsar.blockedHint")}</WarnBanner>
                )}

                <div className="flex gap-3">
                  <MiniStat
                    label={t("board.consumers.pulsar.backlog")}
                    value={shown(current.backlog < 0 ? null : Number(current.backlog))}
                  />
                  <MiniStat
                    label={t("board.consumers.pulsar.unacked")}
                    value={shown(unackedCount(current))}
                  />
                  {/* Delayed messages sit inside the backlog and are nobody's
                      fault. Without this column a scheduled batch reads as a
                      consumer falling behind. */}
                  <MiniStat
                    label={t("board.consumers.pulsar.delayed")}
                    value={shown(delayedCount(current))}
                  />
                  <MiniStat
                    label={t("board.consumers.pulsar.redeliver")}
                    value={shown(redeliverRate(current))}
                  />
                </div>

                <KV
                  rows={[
                    [t("board.consumers.pulsar.topic"), <span className="mono3">{topicOf(current)}</span>],
                    [t("board.consumers.pulsar.type"), subscriptionType(current) || "—"],
                    [
                      t("board.consumers.pulsar.durable"),
                      isDurable(current)
                        ? t("board.consumers.pulsar.durableYes")
                        : t("board.consumers.pulsar.durableNo"),
                    ],
                    [
                      t("board.consumers.pulsar.backlogSize"),
                      backlogBytes(current) == null ? "—" : formatBytes(backlogBytes(current) ?? 0),
                    ],
                    ...(activeConsumer(current) !== ""
                      ? [
                          [
                            t("board.consumers.pulsar.activeConsumer"),
                            <span className="mono3">{activeConsumer(current)}</span>,
                          ] as const,
                        ]
                      : []),
                  ]}
                />

                <SectionLabel>{t("board.consumers.pulsar.attached")}</SectionLabel>
                <BoardState state={detail}>
                  {(detail.data?.clients ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("board.consumers.pulsar.noConsumers")}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("board.consumers.pulsar.consumer")}</TableHead>
                          <TableHead style={R}>{t("board.consumers.pulsar.permits")}</TableHead>
                          <TableHead style={R}>{t("board.consumers.pulsar.unacked")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.data?.clients ?? []).map((client) => (
                          <TableRow key={client.clientId}>
                            <TableCell className="mono3">{client.clientId}</TableCell>
                            {/* Zero permits is a consumer that has stopped
                                asking for messages, which looks identical to a
                                slow one from the rate alone. */}
                            <TableCell style={R}>
                              {client.properties?.["availablePermits"] ?? "—"}
                            </TableCell>
                            <TableCell style={R}>
                              {client.properties?.["unackedMessages"] ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </BoardState>

                <div className="flex justify-end gap-2">
                  <Button size="xs" variant="outline" onClick={() => setResetting(true)}>
                    <History size={13} aria-hidden />
                    {t("board.consumers.pulsar.reset")}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => void remove(topicOf(current), current.ref.name)}
                  >
                    <Trash2 size={13} aria-hidden />
                    {t("board.common.delete")}
                  </Button>
                </div>
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>

      <SubscriptionDialogPulsar
        open={creating}
        topics={topicURLs}
        onClose={() => setCreating(false)}
        onSubmit={create}
      />
      {current != null && (
        <ResetCursorDialogPulsar
          open={resetting}
          topic={topicOf(current)}
          subscription={current.ref.name}
          backlog={current.backlog < 0 ? null : Number(current.backlog)}
          onClose={() => setResetting(false)}
          onSubmit={reset}
        />
      )}
    </Page>
  );
}
