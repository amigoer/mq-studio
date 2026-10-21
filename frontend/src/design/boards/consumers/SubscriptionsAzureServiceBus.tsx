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
  Status,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useServiceBusSubscriptions } from "@/hooks/azureservicebus/useServiceBusSubscriptions";
import {
  receivesNothing,
  subscription as readSubscription,
  type ServiceBusSubscription,
} from "@/mq/azureservicebus/subscriptions";
import { count, duration } from "@/design/boards/topics/EntitiesAzureServiceBus";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as serviceBusApi from "@/api/azureservicebus";
import { SubscriptionDialogAzureServiceBus } from "./SubscriptionDialogAzureServiceBus";

const DASH = "—";

/**
 * Azure Service Bus subscriptions.
 *
 * One row per subscription across every topic in the namespace. This is where
 * a topic's messages actually are: a send is copied into each subscription
 * whose rules let it through, so the backlog on this board is the whole of
 * what a topic is holding on anyone's behalf.
 *
 * The rules column is not decoration. A subscription is created with a
 * $Default rule matching everything, and one whose rules have all been deleted
 * receives nothing while looking healthy on every other figure - it exists, it
 * is Active, and its backlog is zero because nothing can arrive.
 *
 * There is no consumer column, and there cannot be one: a subscription is read
 * by whoever opens a receiver on it and Service Bus keeps no register of who
 * that was. A zero would say "nothing is consuming this".
 */
export function SubscriptionsAzureServiceBus() {
  const { t } = useTranslation();
  const state = useServiceBusSubscriptions();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceBusSubscription | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const subscriptions = useMemo(
    () => (state.data ?? []).map(readSubscription),
    [state.data],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return subscriptions.filter(
      (row) =>
        needle === "" ||
        row.name.toLowerCase().includes(needle) ||
        row.topic.toLowerCase().includes(needle),
    );
  }, [subscriptions, search]);

  const key = (row: ServiceBusSubscription) => `${row.topic}/${row.name}`;
  const current = shown.find((row) => key(row) === selected) ?? null;

  const save = useCallback(
    async (input: serviceBusApi.AzureServiceBusSubscriptionInput) => {
      if (editing == null) {
        await serviceBusApi.createSubscription(connID, input);
        toast.success(t("board.azure-servicebus.subscriptions.created", { name: input.name }));
      } else {
        await serviceBusApi.updateSubscription(connID, input);
        toast.success(t("board.azure-servicebus.subscriptions.updated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, editing, state, t],
  );

  /*
   * The confirmation says what goes with it. A subscription's backlog is its
   * own - the copy that reached it was never the topic's again - so deleting
   * one discards those messages rather than returning them anywhere.
   */
  const remove = useCallback(
    async (row: ServiceBusSubscription) => {
      const ok = await confirm({
        title: t("board.azure-servicebus.subscriptions.deleteTitle", { name: row.name }),
        description: t("board.azure-servicebus.subscriptions.deleteDesc", { topic: row.topic }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await serviceBusApi.removeSubscription(connID, row.topic, row.name);
        toast.success(t("board.azure-servicebus.subscriptions.deleted", { name: row.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.azure-servicebus.subscriptions.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.azure-servicebus.consumers")}
        subtitle={t("board.azure-servicebus.subscriptions.count", {
          count: subscriptions.length,
        })}
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
              {t("board.azure-servicebus.subscriptions.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.azure-servicebus.subscriptions.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <SubscriptionDialogAzureServiceBus
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
                  <TableHead>{t("board.azure-servicebus.subscriptions.name")}</TableHead>
                  <TableHead>{t("board.azure-servicebus.subscriptions.topic")}</TableHead>
                  <TableHead className="num">
                    {t("board.azure-servicebus.subscriptions.backlog")}
                  </TableHead>
                  <TableHead className="num">
                    {t("board.azure-servicebus.subscriptions.deadLetters")}
                  </TableHead>
                  <TableHead>{t("board.azure-servicebus.subscriptions.rules")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow
                    key={key(row)}
                    selected={selected === key(row)}
                    onClick={() => setSelected(key(row))}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{row.name}</span>
                        {/* Said on the row: it is the one state that looks
                            healthy on every other figure, because nothing can
                            arrive to be counted. */}
                        {receivesNothing(row) && (
                          <Status tone="warn">
                            {t("board.azure-servicebus.subscriptions.noRuleBadge")}
                          </Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="select-text">{row.topic}</TableCell>
                    <TableCell className="num">{count(row.backlog)}</TableCell>
                    <TableCell className="num">{count(row.deadLetterCount)}</TableCell>
                    <TableCell className="select-text">
                      {row.ruleNames.join(", ") || DASH}
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {subscriptions.length === 0
                        ? t("board.azure-servicebus.subscriptions.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <SubscriptionSheet
              key={key(current)}
              entry={current}
              onEdit={() => {
                setEditing(current);
                setFormOpen(true);
              }}
              onRemove={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.azure-servicebus.subscriptions.note")}</span>} />
      )}
    </Page>
  );
}

export function SubscriptionSheet({
  entry,
  onEdit,
  onRemove,
  onClose,
}: {
  entry: ServiceBusSubscription;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat
            label={t("board.azure-servicebus.subscriptions.backlog")}
            value={count(entry.backlog)}
          />
          <MiniStat
            label={t("board.azure-servicebus.subscriptions.deadLetters")}
            value={count(entry.deadLetterCount)}
          />
        </div>

        {receivesNothing(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.azure-servicebus.subscriptions.noRuleNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.subscriptions.section.holding")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.azure-servicebus.subscriptions.topic"), entry.topic],
              [
                t("board.azure-servicebus.subscriptions.rules"),
                entry.ruleNames.join(", ") || DASH,
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.subscriptions.section.delivery")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.azure-servicebus.subscriptions.status"), entry.status ?? DASH],
              [
                t("board.azure-servicebus.subscriptions.lockDuration"),
                duration(entry.lockDurationSec),
              ],
              [
                t("board.azure-servicebus.subscriptions.maxDelivery"),
                count(entry.maxDeliveryCount),
              ],
              [t("board.azure-servicebus.subscriptions.ttl"), duration(entry.ttlSec)],
              [
                t("board.azure-servicebus.subscriptions.autoDelete"),
                duration(entry.autoDeleteOnIdleSec),
              ],
              [t("board.azure-servicebus.subscriptions.forwardTo"), entry.forwardTo ?? DASH],
              [
                t("board.azure-servicebus.subscriptions.forwardDeadLettersTo"),
                entry.forwardDeadLettersTo ?? DASH,
              ],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <Button variant="outline" onClick={onEdit}>
          {t("common.edit")}
        </Button>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onRemove}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
