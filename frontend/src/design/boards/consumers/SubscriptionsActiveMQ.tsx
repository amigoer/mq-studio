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
  MiniStat,
  SectionLabel,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useActiveMQSubscriptions } from "@/hooks/activemq/useActiveMQSubscriptions";
import { useActiveMQDestinations } from "@/hooks/activemq/useActiveMQDestinations";
import {
  subscription as readSubscription,
  type ActiveMQSubscription,
} from "@/mq/activemq/subscriptions";
import { destination as readDestination } from "@/mq/activemq/destinations";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as activemqApi from "@/api/activemq";
import { SubscriptionDialogActiveMQ } from "./SubscriptionDialogActiveMQ";

const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * ActiveMQ durable subscriptions.
 *
 * The page shows both attached and detached ones, and the difference is not a
 * health signal. A durable subscription with nothing connected is the broker
 * holding messages for a client that has gone away - which is the entire
 * reason durability exists - so an idle row reads as idle rather than as a
 * fault. What is a fault is Classic's slow-consumer flag, which means the
 * subscriber is falling behind what is being dispatched to it.
 *
 * Only topics have these. A JMS queue's consumers are connections: they have
 * no name, they keep no position, and they are gone when the socket closes.
 * They belong on the connections page and are not listed here.
 */
export function SubscriptionsActiveMQ() {
  const { t } = useTranslation();
  const state = useActiveMQSubscriptions();
  const destinationState = useActiveMQDestinations();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const subscriptions = useMemo(
    () => (state.data ?? []).map(readSubscription),
    [state.data],
  );

  // The dialog needs somewhere to put a subscription, and only a topic can
  // hold one - offering a queue would produce an error the broker explains
  // and the form could have prevented.
  const topics = useMemo(
    () =>
      (destinationState.data ?? [])
        .map(readDestination)
        .filter((entry) => entry.kind === "topic")
        .map((entry) => entry.name),
    [destinationState.data],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return subscriptions;
    return subscriptions.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.topic.toLowerCase().includes(needle),
    );
  }, [subscriptions, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const create = useCallback(
    async (topic: string, name: string, selector: string) => {
      await activemqApi.createSubscription(connID, topic, name, selector);
      toast.success(t("board.activemq.subscriptions.created", { name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (entry: ActiveMQSubscription) => {
      const ok = await confirm({
        title: t("board.activemq.subscriptions.deleteTitle", { name: entry.name }),
        description: t("board.activemq.subscriptions.deleteDesc", {
          count: entry.backlog ?? 0,
        }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await activemqApi.removeSubscription(connID, entry.name);
        toast.success(t("board.activemq.subscriptions.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (removeError) {
        toast.error(t("board.activemq.subscriptions.deleteFailed"), {
          description: formatErrorMessage(removeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.activemq.consumers")}
        subtitle={t("board.activemq.subscriptions.count", {
          count: subscriptions.length,
          attached: subscriptions.filter((entry) => entry.active).length,
        })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t("board.activemq.subscriptions.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.activemq.subscriptions.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <SubscriptionDialogActiveMQ
        open={creating}
        onOpenChange={setCreating}
        topics={topics}
        product={subscriptions[0]?.product ?? "artemis"}
        onCreate={create}
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.activemq.subscriptions.name")}</TableHead>
                  <TableHead>{t("board.activemq.subscriptions.topic")}</TableHead>
                  <TableHead>{t("board.activemq.subscriptions.state")}</TableHead>
                  <TableHead className="num">{t("board.activemq.subscriptions.backlog")}</TableHead>
                  <TableHead className="num">
                    {t("board.activemq.subscriptions.pendingAck")}
                  </TableHead>
                  <TableHead className="num">{t("board.activemq.subscriptions.consumed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="select-text">
                      {entry.subscriptionName ?? entry.name}
                    </TableCell>
                    <TableCell className="select-text">{entry.topic}</TableCell>
                    <TableCell>
                      {/*
                        Detached is the resting state, so it is worded as
                        waiting rather than coloured as broken. Slow is the
                        one that is a problem.
                      */}
                      {entry.slow === true
                        ? t("board.activemq.subscriptions.slow")
                        : entry.active
                          ? t("board.activemq.subscriptions.attached")
                          : t("board.activemq.subscriptions.waiting")}
                    </TableCell>
                    <TableCell className="num">{count(entry.backlog)}</TableCell>
                    <TableCell className="num">{count(entry.pendingAck)}</TableCell>
                    <TableCell className="num">{count(entry.consumed)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {subscriptions.length === 0
                        ? t("board.activemq.subscriptions.none")
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
              onUnsubscribe={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.activemq.subscriptions.note")}</span>} />
      )}
    </Page>
  );
}

function SubscriptionSheet({
  entry,
  onUnsubscribe,
  onClose,
}: {
  entry: ActiveMQSubscription;
  onUnsubscribe: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.subscriptionName ?? entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={t("board.activemq.subscriptions.backlog")}
            value={count(entry.backlog)}
          />
          <MiniStat
            label={t("board.activemq.subscriptions.pendingAck")}
            value={count(entry.pendingAck)}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.activemq.subscriptions.section.state")}
          </SectionLabel>
          <KV
            rows={[
              [
                t("board.activemq.subscriptions.topic"),
                <span className="select-text">{entry.topic}</span>,
              ],
              [t("board.activemq.subscriptions.dispatched"), count(entry.dispatched)],
              [t("board.activemq.subscriptions.consumed"), count(entry.consumed)],
              [t("board.activemq.subscriptions.members"), formatCount(entry.members)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.activemq.subscriptions.section.identity")}
          </SectionLabel>
          <KV
            rows={[
              // Classic identifies a subscription by the client that
              // registered it; Artemis by the queue's own name, and
              // has no client id to show.
              [t("board.activemq.subscriptions.clientId"), entry.clientId ?? DASH],
              [t("board.activemq.subscriptions.selector"), entry.selector ?? DASH],
              [
                t("board.activemq.subscriptions.durable"),
                entry.durable == null
                  ? DASH
                  : entry.durable
                    ? t("common.yes")
                    : t("common.no"),
              ],
              [
                t("board.activemq.subscriptions.deadLetterAddress"),
                entry.deadLetterAddress ?? DASH,
              ],
              [t("board.activemq.subscriptions.prefetch"), count(entry.prefetch)],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onUnsubscribe}>
          {t("board.activemq.subscriptions.unsubscribe")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
