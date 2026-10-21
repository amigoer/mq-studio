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
import { useGooglePubSubTopics } from "@/hooks/googlepubsub/useGooglePubSubTopics";
import {
  discardsEverything,
  topic as readTopic,
  type PubSubTopic,
} from "@/mq/googlepubsub/topics";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as pubsubApi from "@/api/googlepubsub";
import { TopicDialogGooglePubSub } from "./TopicDialogGooglePubSub";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

/** Seconds as the service stores them, read back as something human. */
function duration(seconds: number | null): string {
  if (seconds == null) return DASH;
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * Google Pub/Sub topics.
 *
 * One row per topic in the project, narrowed by the connection's prefix.
 *
 * There is no depth column and there cannot be one. A topic holds nothing: a
 * publish is fanned out to whatever subscriptions exist at that instant, and
 * anything a subscription has not acknowledged is that subscription's backlog
 * rather than the topic's. So the count this board leads with is how many
 * subscriptions read the topic - the one figure that separates a topic doing
 * its job from one accepting every message and throwing it away.
 *
 * There is no rate column and no chart either. Pub/Sub publishes its rates to
 * Cloud Monitoring, which is a different API under a different credential, and
 * a figure derived from two samples here would be this app's arithmetic
 * presented as Google's.
 */
export function TopicsGooglePubSub() {
  const { t } = useTranslation();
  const state = useGooglePubSubTopics();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PubSubTopic | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const topics = useMemo(() => (state.data ?? []).map(readTopic), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return topics.filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle));
  }, [topics, search]);

  const current = shown.find((entry) => entry.name === selected) ?? null;

  const save = useCallback(
    async (input: pubsubApi.GooglePubSubTopicInput) => {
      if (editing == null) {
        await pubsubApi.createTopic(connID, input);
        toast.success(t("board.google-pubsub.topics.created", { name: input.name }));
      } else {
        await pubsubApi.updateTopic(connID, input);
        toast.success(t("board.google-pubsub.topics.updated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, editing, state, t],
  );

  /*
   * The confirmation says what deleting a topic does not do. Its subscriptions
   * survive it, keep whatever they had not delivered, and go on being billed
   * for it while never receiving another message - which is the one
   * consequence nothing else on this board would show.
   */
  const remove = useCallback(
    async (entry: PubSubTopic) => {
      const ok = await confirm({
        title: t("board.google-pubsub.topics.deleteTitle", { name: entry.name }),
        description: t("board.google-pubsub.topics.deleteDesc", { count: entry.subscribers }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await pubsubApi.removeTopic(connID, entry.name);
        toast.success(t("board.google-pubsub.topics.deleted", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.google-pubsub.topics.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.google-pubsub.topics")}
        subtitle={t("board.google-pubsub.topics.count", { count: topics.length })}
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
              {t("board.google-pubsub.topics.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.google-pubsub.topics.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <TopicDialogGooglePubSub
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
                  <TableHead>{t("board.google-pubsub.topics.name")}</TableHead>
                  <TableHead className="num">
                    {t("board.google-pubsub.topics.subscribers")}
                  </TableHead>
                  <TableHead className="num">{t("board.google-pubsub.topics.retention")}</TableHead>
                  <TableHead>{t("board.google-pubsub.topics.subscriptionNames")}</TableHead>
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
                        {/* Said on the row rather than only in the panel: it
                            is the one state that looks healthy everywhere
                            else, because a discarded message leaves no
                            backlog behind it. */}
                        {discardsEverything(entry) && (
                          <Status tone="warn">
                            {t("board.google-pubsub.topics.noSubscriberBadge")}
                          </Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="num">{formatCount(entry.subscribers)}</TableCell>
                    <TableCell className="num">{duration(entry.retentionSec)}</TableCell>
                    <TableCell className="select-text">
                      {entry.subscriptionNames.join(", ") || DASH}
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {topics.length === 0
                        ? t("board.google-pubsub.topics.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <TopicSheet
              key={current.name}
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
        <StatusBar left={<span>{t("board.google-pubsub.topics.note")}</span>} />
      )}
    </Page>
  );
}

export function TopicSheet({
  entry,
  onEdit,
  onRemove,
  onClose,
}: {
  entry: PubSubTopic;
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
            label={t("board.google-pubsub.topics.subscribers")}
            value={formatCount(entry.subscribers)}
          />
          <MiniStat
            label={t("board.google-pubsub.topics.retention")}
            value={duration(entry.retentionSec)}
          />
        </div>

        {/* Said where the number is, because a topic nothing subscribes to
            reports success on every publish and leaves nothing behind. */}
        {discardsEverything(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.google-pubsub.topics.noSubscriberNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.topics.section.delivery")}
          </SectionLabel>
          <KV
            rows={[
              [
                t("board.google-pubsub.topics.subscriptionNames"),
                entry.subscriptionNames.join(", ") || DASH,
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.google-pubsub.topics.section.identity")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.google-pubsub.topics.path"), entry.path ?? DASH],
              [t("board.google-pubsub.topics.state"), entry.state ?? DASH],
              [t("board.google-pubsub.topics.schema"), entry.schema ?? DASH],
              [t("board.google-pubsub.topics.schemaEncoding"), entry.schemaEncoding ?? DASH],
              [t("board.google-pubsub.topics.kmsKey"), entry.kmsKey ?? DASH],
              [
                t("board.google-pubsub.topics.storageRegions"),
                entry.storageRegions.join(", ") || DASH,
              ],
            ]}
          />
        </div>

        {entry.labels.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">
              {t("board.google-pubsub.topics.section.labels")}
            </SectionLabel>
            <KV rows={entry.labels} />
          </div>
        )}
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
