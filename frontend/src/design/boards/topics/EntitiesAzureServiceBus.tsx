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
  OutlineTag,
  SectionLabel,
  Status,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useServiceBusEntities } from "@/hooks/azureservicebus/useServiceBusEntities";
import {
  discardsEverything,
  entity as readEntity,
  isDisabled,
  type ServiceBusEntity,
} from "@/mq/azureservicebus/entities";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as serviceBusApi from "@/api/azureservicebus";
import { EntityDialogAzureServiceBus } from "./EntityDialogAzureServiceBus";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

/** Seconds as the service stores them, read back as something human. */
export function duration(seconds: number | null): string {
  if (seconds == null) return DASH;
  // The service spells "never" as P10675199DT2H48M5.4775807S, which is a real
  // number of seconds and useless as one. Anything past a century is that.
  if (seconds > 100 * 365 * 86400) return "∞";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** A count, or a dash where the service reports none. */
export function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * Azure Service Bus queues and topics.
 *
 * One board for both, because they are the same thing to create, configure and
 * delete: the same properties, the same operations, one name space between
 * them. What separates them is where a message ends up, and the columns say
 * so - a queue has a depth and a topic never can, because a topic holds
 * nothing. A send to it is copied into every subscription whose rules let it
 * through and discarded if none do.
 *
 * A depth that is missing on a queue means something else, and the page says
 * which: the Service Bus emulator reports no message counts at all, so every
 * depth is a dash there and a number against a real namespace.
 *
 * There is no rate column and no chart. Service Bus publishes its rates to
 * Azure Monitor, which is a different API under a different credential, and a
 * figure derived from two samples here would be this app's arithmetic
 * presented as Microsoft's.
 */
export function EntitiesAzureServiceBus() {
  const { t } = useTranslation();
  const state = useServiceBusEntities();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceBusEntity | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const entities = useMemo(() => (state.data ?? []).map(readEntity), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entities.filter((row) => needle === "" || row.name.toLowerCase().includes(needle));
  }, [entities, search]);

  const current = shown.find((row) => row.name === selected) ?? null;

  const save = useCallback(
    async (input: serviceBusApi.AzureServiceBusEntityInput) => {
      if (editing == null) {
        await serviceBusApi.createEntity(connID, input);
        toast.success(t("board.azure-servicebus.entities.created", { name: input.name }));
      } else {
        await serviceBusApi.updateEntity(connID, input);
        toast.success(t("board.azure-servicebus.entities.updated", { name: input.name }));
      }
      await state.refresh();
    },
    [connID, editing, state, t],
  );

  /*
   * The confirmation says what goes with it. An entity's dead letters are a
   * sub-entity of it rather than a queue of their own, and a topic takes every
   * subscription on it - so a delete here discards backlogs that no other
   * board would have shown as being at risk.
   */
  const remove = useCallback(
    async (row: ServiceBusEntity) => {
      const ok = await confirm({
        title: t("board.azure-servicebus.entities.deleteTitle", { name: row.name }),
        description:
          row.kind === "topic"
            ? t("board.azure-servicebus.entities.deleteTopicDesc", { count: row.subscribers ?? 0 })
            : t("board.azure-servicebus.entities.deleteQueueDesc"),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await serviceBusApi.removeEntity(connID, row.name);
        toast.success(t("board.azure-servicebus.entities.deleted", { name: row.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.azure-servicebus.entities.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.azure-servicebus.topics")}
        subtitle={t("board.azure-servicebus.entities.count", {
          queues: entities.filter((row) => row.kind === "queue").length,
          topics: entities.filter((row) => row.kind === "topic").length,
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
              {t("board.azure-servicebus.entities.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.azure-servicebus.entities.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <EntityDialogAzureServiceBus
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
                  <TableHead>{t("board.azure-servicebus.entities.name")}</TableHead>
                  <TableHead>{t("board.azure-servicebus.entities.kind")}</TableHead>
                  <TableHead className="num">
                    {t("board.azure-servicebus.entities.depth")}
                  </TableHead>
                  <TableHead className="num">
                    {t("board.azure-servicebus.entities.deadLetters")}
                  </TableHead>
                  <TableHead className="num">
                    {t("board.azure-servicebus.entities.subscribers")}
                  </TableHead>
                  <TableHead>{t("board.azure-servicebus.entities.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow
                    key={row.name}
                    selected={selected === row.name}
                    onClick={() => setSelected(row.name)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{row.name}</span>
                        {/* Said on the row rather than only in the panel: it
                            is the one state that looks healthy everywhere
                            else, because a discarded message leaves no
                            backlog behind it. */}
                        {discardsEverything(row) && (
                          <Status tone="warn">
                            {t("board.azure-servicebus.entities.noSubscriberBadge")}
                          </Status>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.kind === "topic"
                        ? t("board.azure-servicebus.entities.kindTopic")
                        : t("board.azure-servicebus.entities.kindQueue")}
                    </TableCell>
                    <TableCell className="num">{count(row.depth)}</TableCell>
                    <TableCell className="num">{count(row.deadLetterCount)}</TableCell>
                    <TableCell className="num">{count(row.subscribers)}</TableCell>
                    <TableCell>
                      {isDisabled(row) ? (
                        <Status tone="warn">{row.status}</Status>
                      ) : (
                        (row.status ?? DASH)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {entities.length === 0
                        ? t("board.azure-servicebus.entities.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <EntitySheet
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
        <StatusBar left={<span>{t("board.azure-servicebus.entities.note")}</span>} />
      )}
    </Page>
  );
}

export function EntitySheet({
  entry,
  onEdit,
  onRemove,
  onClose,
}: {
  entry: ServiceBusEntity;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isTopic = entry.kind === "topic";

  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={
          <OutlineTag>
            {isTopic
              ? t("board.azure-servicebus.entities.kindTopic")
              : t("board.azure-servicebus.entities.kindQueue")}
          </OutlineTag>
        }
        onClose={onClose}
      />
      <DetailPanelBody>
        <div className="grid grid-cols-2 gap-2">
          {isTopic ? (
            <>
              <MiniStat
                label={t("board.azure-servicebus.entities.subscribers")}
                value={count(entry.subscribers)}
              />
              <MiniStat
                label={t("board.azure-servicebus.entities.scheduled")}
                value={count(entry.scheduledCount)}
              />
            </>
          ) : (
            <>
              <MiniStat
                label={t("board.azure-servicebus.entities.depth")}
                value={count(entry.depth)}
              />
              <MiniStat
                label={t("board.azure-servicebus.entities.deadLetters")}
                value={count(entry.deadLetterCount)}
              />
            </>
          )}
        </div>

        {/* Said where the number is, because a topic nothing subscribes to
            reports success on every send and leaves nothing behind. */}
        {discardsEverything(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.azure-servicebus.entities.noSubscriberNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.entities.section.holding")}
          </SectionLabel>
          <KV
            rows={
              isTopic
                ? [
                    [
                      t("board.azure-servicebus.entities.subscriptionNames"),
                      entry.subscriptionNames.join(", ") || DASH,
                    ],
                  ]
                : [[t("board.azure-servicebus.entities.scheduled"), count(entry.scheduledCount)]]
            }
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.entities.section.delivery")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.azure-servicebus.entities.status"), entry.status ?? DASH],
              [t("board.azure-servicebus.entities.lockDuration"), duration(entry.lockDurationSec)],
              [t("board.azure-servicebus.entities.maxDelivery"), count(entry.maxDeliveryCount)],
              [t("board.azure-servicebus.entities.ttl"), duration(entry.ttlSec)],
              [
                t("board.azure-servicebus.entities.autoDelete"),
                duration(entry.autoDeleteOnIdleSec),
              ],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.entities.section.shape")}
          </SectionLabel>
          <KV
            rows={[
              [
                t("board.azure-servicebus.entities.maxSize"),
                entry.maxSizeMb == null ? DASH : `${formatCount(entry.maxSizeMb)} MB`,
              ],
              [t("board.azure-servicebus.entities.sessions"), yesNo(t, entry.requiresSession)],
              [
                t("board.azure-servicebus.entities.duplicateDetection"),
                yesNo(t, entry.requiresDuplicateDetection),
              ],
              [t("board.azure-servicebus.entities.partitioned"), yesNo(t, entry.partitioned)],
              [t("board.azure-servicebus.entities.forwardTo"), entry.forwardTo ?? DASH],
              [
                t("board.azure-servicebus.entities.forwardDeadLettersTo"),
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

function yesNo(t: (key: string) => string, value: boolean): string {
  return value ? t("common.yes") : t("common.no");
}
