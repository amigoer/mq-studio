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
import { useKinesisConsumers } from "@/hooks/kinesis/useKinesisConsumers";
import {
  consumer as readConsumer,
  settling,
  type KinesisConsumer,
} from "@/mq/kinesis/subscriptions";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as kinesisApi from "@/api/kinesis";
import { ConsumerDialogKinesis } from "./ConsumerDialogKinesis";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

/**
 * Kinesis registered consumers.
 *
 * The page reads only enhanced fan-out consumers, because they are the only
 * readers a stream knows about. Registering one reserves a name and a
 * dedicated two megabytes a second of read throughput on every shard; an
 * application then subscribes against its ARN. Everything else that reads a
 * Kinesis stream - the KCL, a Lambda event source, anything calling GetRecords
 * - registers nothing at all, so it cannot be listed here and its absence is
 * the service's answer rather than a gap.
 *
 * There is no backlog column, and its absence is the honest answer rather than
 * a hole. A registered consumer carries no position: a classic consumer keeps
 * one in a DynamoDB table the KCL owns, and this kind keeps none. The
 * connection says so through a degraded capability, and the note under the
 * table says it in words.
 */
export function ConsumersKinesis() {
  const { t } = useTranslation();
  const state = useKinesisConsumers();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const consumers = useMemo(() => (state.data ?? []).map(readConsumer), [state.data]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return consumers.filter(
      (entry) =>
        needle === "" ||
        entry.name.toLowerCase().includes(needle) ||
        entry.stream.toLowerCase().includes(needle),
    );
  }, [consumers, search]);

  // Keyed by the pair, because a name is unique only within its stream.
  const keyOf = (entry: KinesisConsumer) => `${entry.stream}/${entry.name}`;
  const current = shown.find((entry) => keyOf(entry) === selected) ?? null;

  const register = useCallback(
    async (stream: string, name: string) => {
      await kinesisApi.registerConsumer(connID, stream, name);
      toast.success(t("board.kinesis.consumers.registered", { name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const deregister = useCallback(
    async (entry: KinesisConsumer) => {
      const ok = await confirm({
        title: t("board.kinesis.consumers.deregisterTitle", { name: entry.name }),
        description: t("board.kinesis.consumers.deregisterDesc"),
        confirmLabel: t("board.kinesis.consumers.deregisterAction"),
        danger: true,
      });
      if (!ok) return;
      try {
        await kinesisApi.deregisterConsumer(connID, entry.stream, entry.name);
        toast.success(t("board.kinesis.consumers.deregistered", { name: entry.name }));
        setSelected(null);
        await state.refresh();
      } catch (removeError) {
        toast.error(t("board.kinesis.consumers.deregisterFailed"), {
          description: formatErrorMessage(removeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.kinesis.consumers")}
        subtitle={t("board.kinesis.consumers.count", { count: consumers.length })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setFormOpen(true)}>
              <Plus aria-hidden />
              {t("board.kinesis.consumers.register")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.kinesis.consumers.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <ConsumerDialogKinesis open={formOpen} onOpenChange={setFormOpen} onSubmit={register} />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.kinesis.consumers.name")}</TableHead>
                  <TableHead>{t("board.kinesis.consumers.stream")}</TableHead>
                  <TableHead>{t("board.kinesis.consumers.status")}</TableHead>
                  <TableHead>{t("board.kinesis.consumers.registeredAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((entry) => (
                  <TableRow
                    key={keyOf(entry)}
                    selected={selected === keyOf(entry)}
                    onClick={() => setSelected(keyOf(entry))}
                  >
                    <TableCell className="select-text">{entry.name}</TableCell>
                    <TableCell className="select-text">{entry.stream}</TableCell>
                    <TableCell>
                      <ConsumerStatus entry={entry} />
                    </TableCell>
                    <TableCell>{formatMessageTime(entry.registeredAtMs)}</TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {consumers.length === 0
                        ? t("board.kinesis.consumers.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <ConsumerSheet
              key={keyOf(current)}
              entry={current}
              onDeregister={() => void deregister(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && <StatusBar left={<span>{t("board.kinesis.consumers.note")}</span>} />}
    </Page>
  );
}

function ConsumerStatus({ entry }: { entry: KinesisConsumer }) {
  if (entry.status == null) return <Status tone="off">{DASH}</Status>;
  return <Status tone={settling(entry) ? "warn" : "ok"}>{entry.status}</Status>;
}

function ConsumerSheet({
  entry,
  onDeregister,
  onClose,
}: {
  entry: KinesisConsumer;
  onDeregister: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={<ConsumerStatus entry={entry} />}
        onClose={onClose}
      />
      <DetailPanelBody>
        {/* Said where the row is: an application pointed at a consumer that is
            not ACTIVE fails with an error about the consumer, not the stream. */}
        {settling(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.kinesis.consumers.settling", { status: entry.status })}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.kinesis.consumers.section.registration")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.kinesis.consumers.stream"), entry.stream],
              [t("board.kinesis.consumers.registeredAt"), formatMessageTime(entry.registeredAtMs)],
              [t("board.kinesis.consumers.arn"), entry.arn ?? DASH],
            ]}
          />
        </div>
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onDeregister}>
          {t("board.kinesis.consumers.deregisterAction")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
