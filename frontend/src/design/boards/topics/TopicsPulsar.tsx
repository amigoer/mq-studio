import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  OutlineTag,
  Panel,
  SectionLabel,
  SelectField,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { usePulsarNamespaces } from "@/hooks/pulsar/usePulsarNamespaces";
import { usePulsarTopicDetail, usePulsarTopics } from "@/hooks/pulsar/usePulsarTopics";
import * as pulsarApi from "@/api/pulsar";
import {
  averageMessageBytes,
  isPartitioned,
  isPersistent,
  producerCount,
  reported,
  storageBytes,
  topicURL,
} from "@/mq/pulsar/destinations";
import { parsePartitions } from "@/mq/pulsar/destinations";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { TopicDialogPulsar, type PulsarTopicForm } from "./TopicDialogPulsar";

const R = { textAlign: "right" } as const;

/** A figure the driver did not report, drawn as absent rather than as zero. */
function shown(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 12a — Pulsar topics, scoped by a tenant / namespace cascade.
 *
 * The cascade is not a filter bolted on top: a Pulsar topic is addressed as
 * tenant/namespace/name, so a listing with no namespace has no scope at all.
 * That is why the namespace selector sits in the toolbar rather than in an
 * advanced panel, and why it defaults to the one the connection was configured
 * with.
 *
 * Two columns exist here that no other family has. Persistence is a property
 * of the topic and decides whether anything is kept at all - a non-persistent
 * topic drops a message nobody is connected to receive - and it is part of
 * every address the driver builds. Partitioned is a shape rather than a count:
 * a non-partitioned topic can never become partitioned, and a partitioned one
 * with a single partition can grow.
 */
export function TopicsPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const namespaces = usePulsarNamespaces();
  const [namespace, setNamespace] = useState("");
  const [includeInternal, setIncludeInternal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const scope = namespace || (namespaces.data?.[0]?.name ?? "");
  const state = usePulsarTopics(scope);
  const topics = (state.data ?? []).filter(
    (topic) => includeInternal || !topic.ref.name.startsWith("__"),
  );
  const detail = usePulsarTopicDetail(scope, selected);

  const create = async (form: PulsarTopicForm) => {
    const partitions = parsePartitions(form.partitions);
    if ("error" in partitions) return;
    await pulsarApi.createPulsarTopic(connID, {
      namespace: scope,
      name: form.name,
      partitions: partitions.value,
      persistent: form.persistent,
    } as pulsarApi.PulsarTopicInput);
    await state.refresh();
    toast.success(t("board.topics.pulsar.created", { name: form.name }));
  };

  const remove = async (name: string) => {
    const ok = await confirm({
      title: t("board.topics.pulsar.deleteTitle"),
      description: t("board.topics.pulsar.deleteBody", { name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await pulsarApi.removePulsarTopic(connID, scope, name);
      setSelected(null);
      await state.refresh();
      toast.success(t("board.topics.pulsar.deleted", { name }));
    } catch (failure) {
      // Pulsar refuses while a producer or consumer is still attached. That is
      // the message worth showing: it names what has to be dealt with first.
      toast.error(formatErrorMessage(failure));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.topics.pulsar.title")}
        subtitle={scope}
        actions={
          <>
            <Button size="sm" onClick={() => setCreating(true)} disabled={!state.online}>
              <Plus size={14} aria-hidden />
              {t("board.topics.pulsar.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </>
        }
      />
      <Toolbar>
        <SelectField
          value={scope}
          options={(namespaces.data ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
          }))}
          onValueChange={(next) => {
            setNamespace(next);
            setSelected(null);
          }}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={includeInternal} onCheckedChange={setIncludeInternal} />
          {t("board.topics.pulsar.includeInternal")}
        </label>
      </Toolbar>
      <BoardState state={state}>
        <ListArea>
          <ListPane>
            <Panel>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.topics.pulsar.name")}</TableHead>
                    <TableHead>{t("board.topics.pulsar.storage")}</TableHead>
                    <TableHead style={R}>{t("board.topics.pulsar.partitions")}</TableHead>
                    <TableHead style={R}>{t("board.topics.pulsar.backlog")}</TableHead>
                    <TableHead style={R}>{t("board.topics.pulsar.subscriptions")}</TableHead>
                    <TableHead style={R}>{t("board.topics.pulsar.size")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topics.map((topic) => (
                    <TableRow
                      key={topic.ref.name}
                      data-state={topic.ref.name === selected ? "selected" : undefined}
                      onClick={() => setSelected(topic.ref.name)}
                    >
                      <TableCell className="mono3">{topic.ref.name}</TableCell>
                      <TableCell>
                        {isPersistent(topic) ? (
                          <OutlineTag>persistent</OutlineTag>
                        ) : (
                          /* Warned rather than tagged: this topic keeps
                             nothing, so a message nobody is connected to
                             receive is gone, and that is worth reading as a
                             property and not a label. */
                          <Status tone="warn">non-persistent</Status>
                        )}
                      </TableCell>
                      <TableCell style={R}>
                        {isPartitioned(topic)
                          ? shown(reported(topic.partitions))
                          : t("board.topics.pulsar.notPartitioned")}
                      </TableCell>
                      <TableCell style={R}>{shown(reported(Number(topic.depth)))}</TableCell>
                      <TableCell style={R}>{shown(reported(topic.subscribers))}</TableCell>
                      <TableCell style={R}>
                        {storageBytes(topic) == null
                          ? "—"
                          : formatBytes(storageBytes(topic) ?? 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          </ListPane>

          {selected != null && (
            <DetailPanel>
              <DetailPanelHeader title={selected} onClose={() => setSelected(null)} />
              <DetailPanelBody>
                <BoardState state={detail}>
                  {detail.data != null && (
                    <>
                      <KV
                        rows={[
                          [
                            t("board.topics.pulsar.address"),
                            <span className="mono3">{topicURL(detail.data.topic)}</span>,
                          ],
                          [
                            t("board.topics.pulsar.producers"),
                            shown(producerCount(detail.data.topic)),
                          ],
                          [
                            t("board.topics.pulsar.averageSize"),
                            averageMessageBytes(detail.data.topic) == null
                              ? "—"
                              : formatBytes(averageMessageBytes(detail.data.topic) ?? 0),
                          ],
                        ]}
                      />

                      {detail.data.partitions.length > 0 && (
                        <>
                          <SectionLabel>{t("board.topics.pulsar.perPartition")}</SectionLabel>
                          {/* The view that shows one partition carrying the
                              whole topic, which a total cannot. */}
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t("board.topics.pulsar.partition")}</TableHead>
                                <TableHead style={R}>
                                  {t("board.topics.pulsar.backlog")}
                                </TableHead>
                                <TableHead style={R}>{t("board.topics.pulsar.size")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {detail.data.partitions.map((partition) => (
                                <TableRow key={partition.name}>
                                  <TableCell className="mono3">
                                    {partition.name.split("/").pop()}
                                  </TableCell>
                                  <TableCell style={R}>{shown(partition.backlog)}</TableCell>
                                  <TableCell style={R}>
                                    {partition.storageSize == null
                                      ? "—"
                                      : formatBytes(partition.storageSize)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </>
                      )}

                      <div className="flex justify-end">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => void remove(selected)}
                        >
                          <Trash2 size={13} aria-hidden />
                          {t("board.common.delete")}
                        </Button>
                      </div>
                    </>
                  )}
                </BoardState>
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>

      <TopicDialogPulsar
        open={creating}
        namespace={scope}
        onClose={() => setCreating(false)}
        onSubmit={create}
      />
    </Page>
  );
}
