import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
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
  DetailPanelHeader,
  KV,
  MiniStat,
  SectionLabel,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useIbmMqSubscriptions } from "@/hooks/ibmmq/useIbmMqSubscriptions";
import {
  subscription as readSubscription,
  unread,
  type IbmMqSubscription,
} from "@/mq/ibmmq/subscriptions";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * The queue manager's subscriptions.
 *
 * A subscription registers interest in a topic string and names a queue to
 * deliver to, so this page carries two numbers that are easy to confuse and
 * both worth having: how many publications the subscription has ever received,
 * which is a lifetime total the queue manager keeps, and how many are still
 * waiting, which is the depth of the queue it delivers to.
 *
 * "Attached" is the column that reads wrong if it is read as "online". An
 * administrative subscription - one an operator defined - has nothing attached
 * by design: the publications land on its destination queue and whichever
 * application reads that queue is the consumer. So the row is flagged when its
 * queue is filling up with nobody at the other end, not when nothing is
 * connected.
 *
 * There is no create and no delete. The commands exist and this driver does
 * not offer them: a subscription's identity is a topic string, a destination
 * queue and a durability together, which needs a form rather than a name
 * field.
 */
export function SubscriptionsIbmMq() {
  const { t } = useTranslation();
  const state = useIbmMqSubscriptions();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

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
        (entry.topicString ?? "").toLowerCase().includes(needle),
    );
  }, [subscriptions, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.ibmmq.consumers")}
        subtitle={t("board.ibmmq.subscriptions.count", { count: subscriptions.length })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.ibmmq.subscriptions.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead className="mqs-col-fill">{t("board.ibmmq.subscriptions.name")}</TableHead>
                  <TableHead>{t("board.ibmmq.subscriptions.topicString")}</TableHead>
                  <TableHead>{t("board.ibmmq.subscriptions.destination")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.subscriptions.waiting")}</TableHead>
                  <TableHead className="num">{t("board.ibmmq.subscriptions.received")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell className="mqs-col-fill select-text">{entry.name}</TableCell>
                    <TableCell className="select-text">{entry.topicString || DASH}</TableCell>
                    <TableCell className="select-text">{entry.destination || DASH}</TableCell>
                    <TableCell className={cn("num", unread(entry) && "text-(--c-warn-text)")}>
                      {count(entry.backlog)}
                    </TableCell>
                    <TableCell className="num">{count(entry.messagesReceived)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {subscriptions.length === 0
                        ? t("board.ibmmq.subscriptions.none")
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
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.ibmmq.subscriptions.note")}</span>} />
      )}
    </Page>
  );
}

export function SubscriptionSheet({
  entry,
  onClose,
}: {
  entry: IbmMqSubscription;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={t("board.ibmmq.subscriptions.waiting")} value={count(entry.backlog)} />
          <MiniStat
            label={t("board.ibmmq.subscriptions.received")}
            value={count(entry.messagesReceived)}
          />
        </div>

        {unread(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.ibmmq.subscriptions.unread", {
              queue: entry.destination ?? "",
            })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.ibmmq.subscriptions.section.definition")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.ibmmq.subscriptions.topicString"), entry.topicString || DASH],
              [t("board.ibmmq.subscriptions.destination"), entry.destination || DASH],
              [
                t("board.ibmmq.subscriptions.destinationQmgr"),
                entry.destinationQueueManager || DASH,
              ],
              [
                t("board.ibmmq.subscriptions.kind"),
                entry.kind == null
                  ? DASH
                  : t(`board.ibmmq.subscriptions.kindValue.${entry.kind}`, {
                      defaultValue: entry.kind,
                    }),
              ],
              [
                t("board.ibmmq.subscriptions.durable"),
                entry.durable
                  ? t("board.ibmmq.subscriptions.durableYes")
                  : t("board.ibmmq.subscriptions.durableNo"),
              ],
              [t("board.ibmmq.subscriptions.user"), entry.user || DASH],
              [t("board.ibmmq.subscriptions.selector"), entry.selector || DASH],
              [t("board.ibmmq.subscriptions.id"), entry.subscriptionId || DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.ibmmq.subscriptions.section.runtime")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.ibmmq.subscriptions.queueReaders"), count(entry.queueReaders)],
              [
                t("board.ibmmq.subscriptions.attached"),
                entry.attached
                  ? t("board.ibmmq.subscriptions.attachedYes")
                  : t("board.ibmmq.subscriptions.attachedNo"),
              ],
              [t("board.ibmmq.subscriptions.lastMessage"), entry.lastMessageAt || DASH],
            ]}
          />
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
