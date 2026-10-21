import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  KV,
  SectionLabel,
  Status,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useGooglePubSubSubscriptions } from "@/hooks/googlepubsub/useGooglePubSubSubscriptions";
import { useGooglePubSubSnapshots } from "@/hooks/googlepubsub/useGooglePubSubSnapshots";
import {
  receivesNothing,
  subscription as readSubscription,
  type PubSubSubscription,
} from "@/mq/googlepubsub/subscriptions";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as pubsubApi from "@/api/googlepubsub";
import { SubscriptionDialogGooglePubSub } from "./SubscriptionDialogGooglePubSub";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function duration(seconds: number | null): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Google Pub/Sub subscriptions.
 *
 * This is the page the family adds. An SQS queue was one object and a consumer
 * was whoever asked it for messages; here a subscription is its own object,
 * created and deleted independently of the topic, and it carries the whole of
 * the delivery configuration - how long a message is held, how long it is
 * kept, how many attempts before it is given up on, and where it goes then.
 *
 * There is no backlog column, and its absence is the honest answer rather than
 * a gap. num_undelivered_messages is a Cloud Monitoring metric: it is not on
 * the subscription the admin API returns, and there is no call anywhere in
 * Pub/Sub that reports it. The connection says so through a degraded
 * capability, and the note under the table says it in words.
 */
export function SubscriptionsGooglePubSub() {
  const { t } = useTranslation();
  const state = useGooglePubSubSubscriptions();
  const snapshots = useGooglePubSubSnapshots();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PubSubSubscription | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const subscriptions = useMemo(
    () => (state.data ?? []).map(readSubscription),
    [state.data],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return subscriptions.filter(
      (entry) =>
        needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        entry.topic.toLowerCase().includes(needle),
    );
  }, [subscriptions, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const save = useCallback(
    async (input: pubsubApi.GooglePubSubSubscriptionInput) => {
      if (editing == null) {
        await pubsubApi.createSubscription(connID, input);
        toast.success(t("board.google-pubsub.subscriptions.created", { name: input.name }));
      } else {
        await pubsubApi.updateSubscription(connID, input);
        toast.success(t("board.google-pubsub.subscriptions.updated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, editing, state, t],
  );

  /*
   * The confirmation says what goes with it. A subscription holds what it has
   * not acknowledged, and those messages were never the topic's to hand out
   * again - deleting the subscription discards them with no way back.
   */
  const remove = useCallback(
    async (entry: PubSubSubscription) => {
      const ok = await confirm({
        title: t("board.google-pubsub.subscriptions.deleteTitle", { name: entry.name }),
        description: t("board.google-pubsub.subscriptions.deleteDesc"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await pubsubApi.removeSubscription(connID, entry.name);
        toast.success(t("board.google-pubsub.subscriptions.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.google-pubsub.subscriptions.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  /*
   * Taking a restore point is the one control here that costs storage rather
   * than changing behaviour, so the confirmation says so: while the snapshot
   * exists the topic keeps every message it could restore.
   */
  const snapshot = useCallback(
    async (entry: PubSubSubscription) => {
      const name = `${entry.name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
      const ok = await confirm({
        title: t("board.google-pubsub.subscriptions.snapshotTitle", { name }),
        description: t("board.google-pubsub.subscriptions.snapshotDesc"),
        confirmLabel: t("board.google-pubsub.subscriptions.snapshotAction"),
      });
      if (!ok) return;
      try {
        await pubsubApi.createSnapshot(connID, name, entry.name);
        toast.success(t("board.google-pubsub.subscriptions.snapshotTaken", { name }));
        await snapshots.refresh();
      } catch (snapshotError) {
        toast.error(t("board.google-pubsub.subscriptions.snapshotFailed"), {
          description: formatErrorMessage(snapshotError),
        });
      }
    },
    [confirm, connID, snapshots, t],
  );

  const restore = useCallback(
    async (entry: PubSubSubscription, name: string) => {
      const ok = await confirm({
        title: t("board.google-pubsub.subscriptions.restoreTitle", {
          name,
          subscription: entry.name,
        }),
        description: t("board.google-pubsub.subscriptions.restoreDesc"),
        confirmLabel: t("board.google-pubsub.subscriptions.restoreAction"),
        danger: true,
      });
      if (!ok) return;
      try {
        await pubsubApi.seekToSnapshot(connID, entry.name, name);
        toast.success(t("board.google-pubsub.subscriptions.restored", { name }));
      } catch (restoreError) {
        toast.error(t("board.google-pubsub.subscriptions.restoreFailed"), {
          description: formatErrorMessage(restoreError),
        });
      }
    },
    [confirm, connID, t],
  );

  const dropSnapshot = useCallback(
    async (name: string) => {
      try {
        await pubsubApi.removeSnapshot(connID, name);
        toast.success(t("board.google-pubsub.subscriptions.snapshotDeleted", { name }));
        await snapshots.refresh();
      } catch (deleteError) {
        toast.error(t("board.google-pubsub.subscriptions.snapshotDeleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [connID, snapshots, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.google-pubsub.consumers")}
        subtitle={t("board.google-pubsub.subscriptions.count", { count: subscriptions.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button
              disabled={!state.online}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden />
              {t("board.google-pubsub.subscriptions.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.google-pubsub.subscriptions.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <SubscriptionDialogGooglePubSub
        open={formOpen}
        editing={editing}
        onOpenChange={setFormOpen}
        onSubmit={save}
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.google-pubsub.subscriptions.name")}</TableHead>
                  <TableHead>{t("board.google-pubsub.subscriptions.topic")}</TableHead>
                  <TableHead>{t("board.google-pubsub.subscriptions.delivery")}</TableHead>
                  <TableHead className="num">
                    {t("board.google-pubsub.subscriptions.ackDeadline")}
                  </TableHead>
                  <TableHead>{t("board.google-pubsub.subscriptions.deadLetterTopic")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {/* Two ways to be finished and neither is an error
                            state, so nothing else on the row would say it. */}
                        {receivesNothing(entry) && (
                          <Status tone="warn">
                            {t(
                              entry.orphaned
                                ? "board.google-pubsub.subscriptions.orphanedBadge"
                                : "board.google-pubsub.subscriptions.detachedBadge",
                            )}
                          </Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="select-text">{entry.topic || DASH}</TableCell>
                    <TableCell>
                      {t(`board.google-pubsub.subscriptions.deliveryKind.${entry.delivery}`)}
                    </TableCell>
                    <TableCell className="num">{duration(entry.ackDeadlineSec)}</TableCell>
                    <TableCell className="select-text">{entry.deadLetterTopic ?? DASH}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {subscriptions.length === 0
                        ? t("board.google-pubsub.subscriptions.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <SubscriptionSheet
              key={current.name}
              entry={current}
              snapshots={(snapshots.data ?? []).filter(
                (candidate) => candidate.topic === current.topic,
              )}
              onEdit={() => {
                setEditing(current);
                setFormOpen(true);
              }}
              onRemove={() => void remove(current)}
              onSnapshot={() => void snapshot(current)}
              onRestore={(name) => void restore(current, name)}
              onDropSnapshot={(name) => void dropSnapshot(name)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.google-pubsub.subscriptions.note")}</span>} />
      )}
    </Page>
  );
}

export function SubscriptionSheet({
  entry,
  snapshots,
  onEdit,
  onRemove,
  onSnapshot,
  onRestore,
  onDropSnapshot,
  onClose,
}: {
  entry: PubSubSubscription;
  snapshots: pubsubApi.GooglePubSubSnapshot[];
  onEdit: () => void;
  onRemove: () => void;
  onSnapshot: () => void;
  onRestore: (name: string) => void;
  onDropSnapshot: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        {receivesNothing(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t(
              entry.orphaned
                ? "board.google-pubsub.subscriptions.orphanedNote"
                : "board.google-pubsub.subscriptions.detachedNote",
            )}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.subscriptions.section.delivery")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.google-pubsub.subscriptions.topic"), entry.topic || DASH],
              [
                t("board.google-pubsub.subscriptions.delivery"),
                t(`board.google-pubsub.subscriptions.deliveryKind.${entry.delivery}`),
              ],
              [t("board.google-pubsub.subscriptions.pushEndpoint"), entry.pushEndpoint ?? DASH],
              [
                t("board.google-pubsub.subscriptions.ackDeadline"),
                duration(entry.ackDeadlineSec),
              ],
              [t("board.google-pubsub.subscriptions.retention"), duration(entry.retentionSec)],
              [
                t("board.google-pubsub.subscriptions.retainAcked"),
                t(entry.retainAcked ? "common.yes" : "common.no"),
              ],
              [
                t("board.google-pubsub.subscriptions.expiration"),
                duration(entry.expirationTtlSec),
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.subscriptions.section.failures")}
          </SectionLabel>
          <KV
            rows={[
              [
                t("board.google-pubsub.subscriptions.deadLetterTopic"),
                entry.deadLetterTopic ?? DASH,
              ],
              [
                t("board.google-pubsub.subscriptions.maxAttempts"),
                entry.maxDeliveryAttempts == null ? DASH : String(entry.maxDeliveryAttempts),
              ],
              [
                t("board.google-pubsub.subscriptions.retryBackoff"),
                entry.retryMinBackoffSec == null
                  ? DASH
                  : `${duration(entry.retryMinBackoffSec)} – ${duration(entry.retryMaxBackoffSec)}`,
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.subscriptions.section.identity")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.google-pubsub.subscriptions.state"), entry.state ?? DASH],
              [t("board.google-pubsub.subscriptions.filter"), entry.filter ?? DASH],
              [
                t("board.google-pubsub.subscriptions.ordering"),
                t(entry.ordering ? "common.yes" : "common.no"),
              ],
              [
                t("board.google-pubsub.subscriptions.exactlyOnce"),
                t(entry.exactlyOnce ? "common.yes" : "common.no"),
              ],
              [t("board.google-pubsub.subscriptions.path"), entry.path ?? DASH],
            ]}
          />
        </div>

        {entry.labels.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">
              {t("board.google-pubsub.subscriptions.section.labels")}
            </SectionLabel>
            <KV rows={entry.labels} />
          </div>
        )}

        {/* Restore points, which are the only seek target that always works:
            the emulator will not seek an ordered subscription to a timestamp,
            and a snapshot names the place rather than describing it. */}
        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.subscriptions.section.snapshots")}
          </SectionLabel>
          {snapshots.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("board.google-pubsub.subscriptions.noSnapshots")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {snapshots.map((candidate) => (
                <div key={candidate.name} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 text-sm break-words select-text">
                    {candidate.name}
                    <span className="text-muted-foreground">
                      {" "}
                      {formatMessageTime(candidate.expiresAtMs)}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onRestore(candidate.name)}>
                    {t("board.google-pubsub.subscriptions.restoreAction")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onDropSnapshot(candidate.name)}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onEdit}>
          {t("common.edit")}
        </Button>
        <Button variant="outline" onClick={onSnapshot}>
          {t("board.google-pubsub.subscriptions.snapshotAction")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onRemove}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
