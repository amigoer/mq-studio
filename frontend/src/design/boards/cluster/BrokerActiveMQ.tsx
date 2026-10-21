import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
} from "@/design/shell";
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
  SectionLabel,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import {
  useActiveMQNodeConfig,
  useActiveMQNodes,
} from "@/hooks/activemq/useActiveMQCluster";
import { node as readNode, type ActiveMQNode } from "@/mq/activemq/cluster";
import { formatBytes, formatCount } from "@/lib/format";

const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

function percent(value: number | null): string {
  return value == null ? DASH : `${value}%`;
}

function yesNo(value: boolean | null, yes: string, no: string): string {
  return value == null ? DASH : value ? yes : no;
}

/**
 * The ActiveMQ broker.
 *
 * This is a broker page more than a cluster page, and the difference is the
 * family's rather than the driver's. A JMS broker is a unit: destinations live
 * on the one that owns them, clients connect to it, and clustering here is a
 * bridge between brokers rather than a set of nodes sharing a namespace. So an
 * ordinary deployment shows one row, and the extra rows are links this broker
 * declares - Classic's network connectors, Artemis's cluster connections.
 *
 * A bridged row's state is unknown by construction and says so. The link is
 * configured here; the broker at the other end answers on its own console,
 * which this connection has no way to reach, so reporting it as online or
 * offline would be a guess either way.
 *
 * No rate anywhere. Both products keep cumulative enqueue and dequeue
 * counters, and dividing two samples of those would be this app's arithmetic
 * printed as the broker's figure.
 */
export function BrokerActiveMQ() {
  const { t } = useTranslation();
  const state = useActiveMQNodes();
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(() => (state.data ?? []).map(readNode), [state.data]);
  const current = nodes.find((entry) => entry.name === selected) ?? null;

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.activemq.cluster")}
        subtitle={t("board.activemq.cluster.count", {
          bridges: nodes.filter((entry) => entry.bridge).length,
        })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.activemq.cluster.name")}</TableHead>
                  <TableHead>{t("board.activemq.cluster.version")}</TableHead>
                  <TableHead>{t("board.activemq.cluster.uptime")}</TableHead>
                  <TableHead className="num">{t("board.activemq.cluster.messages")}</TableHead>
                  <TableHead className="num">{t("board.activemq.cluster.connections")}</TableHead>
                  <TableHead className="num">{t("board.activemq.cluster.disk")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((entry) => (
                  <TableRow
                    key={entry.name}
                    selected={selected === entry.name}
                    onClick={() => setSelected(entry.name)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{entry.name}</span>
                        {entry.bridge && (
                          <OutlineTag>{t("board.activemq.cluster.bridgeBadge")}</OutlineTag>
                        )}
                        {entry.backup === true && (
                          <OutlineTag>{t("board.activemq.cluster.backupBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{entry.version === "" ? DASH : entry.version}</TableCell>
                    <TableCell>{entry.uptime ?? DASH}</TableCell>
                    <TableCell className="num">{count(entry.totalMessages)}</TableCell>
                    <TableCell className="num">{count(entry.connections)}</TableCell>
                    <TableCell className="num">{percent(entry.diskUsage)}</TableCell>
                  </TableRow>
                ))}
                {nodes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {t("board.activemq.cluster.none")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <BrokerSheet
              key={current.name}
              entry={current}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.activemq.cluster.note")}</span>} />
      )}
    </Page>
  );
}

function BrokerSheet({ entry, onClose }: { entry: ActiveMQNode; onClose: () => void }) {
  const { t } = useTranslation();
  // Only the broker itself has settings to read; a bridge is a name.
  const configState = useActiveMQNodeConfig(entry.bridge ? null : entry.address);

  // ConfigDocument is the map itself, not a wrapper around one.
  const settings = useMemo(() => {
    const document = configState.data;
    if (document == null) return [];
    return Object.entries(document)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => [key, value as string] as const)
      .sort(([left], [right]) => left.localeCompare(right));
  }, [configState.data]);

  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.name}
        badge={
          entry.bridge ? (
            <OutlineTag>{t("board.activemq.cluster.bridgeBadge")}</OutlineTag>
          ) : entry.backup === true ? (
            <OutlineTag>{t("board.activemq.cluster.backupBadge")}</OutlineTag>
          ) : undefined
        }
        onClose={onClose}
      />
      <DetailPanelBody>
        {entry.bridge ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.activemq.cluster.bridgeNote")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat
                label={t("board.activemq.cluster.messages")}
                value={count(entry.totalMessages)}
              />
              <MiniStat label={t("board.activemq.cluster.disk")} value={percent(entry.diskUsage)} />
            </div>

            <div>
              <SectionLabel className="mb-1.5">
                {t("board.activemq.cluster.section.identity")}
              </SectionLabel>
              <KV
                rows={[
                  [t("board.activemq.cluster.version"), entry.version || DASH],
                  [t("board.activemq.cluster.nodeId"), entry.nodeId ?? DASH],
                  [t("board.activemq.cluster.uptime"), entry.uptime ?? DASH],
                  [
                    t("board.activemq.cluster.persistent"),
                    yesNo(entry.persistent, t("common.yes"), t("common.no")),
                  ],
                  [t("board.activemq.cluster.dataDirectory"), entry.dataDirectory ?? DASH],
                ]}
              />
            </div>

            <div>
              <SectionLabel className="mb-1.5">{t("board.activemq.cluster.section.load")}</SectionLabel>
              <KV
                rows={[
                  [t("board.activemq.cluster.enqueued"), count(entry.totalEnqueued)],
                  [t("board.activemq.cluster.dequeued"), count(entry.totalDequeued)],
                  [t("board.activemq.cluster.consumers"), count(entry.consumers)],
                  [t("board.activemq.cluster.producers"), count(entry.producers)],
                ]}
              />
            </div>

            <div>
              <SectionLabel className="mb-1.5">
                {t("board.activemq.cluster.section.storage")}
              </SectionLabel>
              <KV
                rows={[
                  [t("board.activemq.cluster.store"), percent(entry.storePercent)],
                  [t("board.activemq.cluster.temp"), percent(entry.tempPercent)],
                  [t("board.activemq.cluster.memory"), percent(entry.memoryPercent)],
                  [
                    t("board.activemq.cluster.memoryLimit"),
                    entry.memoryLimit == null ? DASH : formatBytes(entry.memoryLimit),
                  ],
                  [t("board.activemq.cluster.journalType"), entry.journalType ?? DASH],
                ]}
              />
            </div>

            {entry.product === "artemis" && (
              <div>
                <SectionLabel className="mb-1.5">
                  {t("board.activemq.cluster.section.availability")}
                </SectionLabel>
                <KV
                  rows={[
                    [
                      t("board.activemq.cluster.clustered"),
                      yesNo(entry.clustered, t("common.yes"), t("common.no")),
                    ],
                    [t("board.activemq.cluster.haPolicy"), entry.haPolicy ?? DASH],
                    [
                      t("board.activemq.cluster.security"),
                      yesNo(entry.securityEnabled, t("common.yes"), t("common.no")),
                    ],
                    [t("board.activemq.cluster.acceptors"), entry.acceptors?.join(", ") ?? DASH],
                  ]}
                />
              </div>
            )}

            <div>
              <SectionLabel className="mb-1.5">
                {t("board.activemq.cluster.section.settings")}
              </SectionLabel>
              {settings.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("board.activemq.cluster.noSettings")}
                </p>
              ) : (
                <KV rows={settings} />
              )}
            </div>
          </>
        )}
      </DetailPanelBody>
    </DetailPanel>
  );
}
