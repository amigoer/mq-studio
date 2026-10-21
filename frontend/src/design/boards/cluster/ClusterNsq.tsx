import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton } from "@/design/shell";
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
  SectionLabel,
  StatTile,
  Status,
  WarnBanner,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { KPI_GRID } from "@/design/boards/overview/_shared";
import { useNsqCluster, useNsqNodeConfig } from "@/hooks/nsq/useNsqCluster";
import {
  advertisesSomethingElse,
  directoryNode as readDirectoryNode,
  node as readNode,
  type NsqDirectoryNode,
  type NsqNode,
} from "@/mq/nsq/cluster";
import { formatBytes, formatCount } from "@/lib/format";
import { present } from "@/api/client";

/** A dash, not a zero: an absent figure and a measured zero are not alike. */
const DASH = "—";

function count(value: number | null): string {
  return value == null ? DASH : formatCount(value);
}

/**
 * The NSQ cluster: the daemons that hold messages, and the tier that tells
 * consumers where they are.
 *
 * Two tables rather than one, because the two answer different questions and
 * can disagree. The nsqd list is the profile's own - there is no daemon that
 * knows about the others, so it is exactly the set every figure elsewhere in
 * the app is a sum over. The nsqlookupd list is what a consumer is told when
 * it asks, and the addresses it hands out are whatever each nsqd broadcast
 * about itself, which need not be reachable from here.
 *
 * That mismatch is the one thing this page warns about. A daemon this app
 * reaches at 127.0.0.1:4151 and advertises as a container hostname sends every
 * consumer using discovery somewhere it cannot go, and nothing else in the app
 * can see it.
 *
 * There is no disk figure and no rate. nsqd reports neither: a topic's
 * overflow file sits wherever --data-path points and the daemon never looks at
 * it, and every message figure is a total since start rather than a rate.
 */
export function ClusterNsq() {
  const { t } = useTranslation();
  const state = useNsqCluster();
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(() => present(state.data?.nodes).map(readNode), [state.data]);
  const directory = useMemo(
    () => present(state.data?.directory).map(readDirectoryNode),
    [state.data],
  );
  const overview = state.data?.overview;

  const current = nodes.find((entry) => entry.address === selected) ?? null;

  const unreachable = useMemo(
    () => advertisesSomethingElse(directory, nodes),
    [directory, nodes],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.nsq.cluster")}
        subtitle={t("board.nsq.cluster.subtitle", {
          nodes: nodes.length,
          directory: directory.length,
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
        <>
          <div className="flex flex-none flex-col gap-3 pt-4 pb-4">
            {unreachable.length > 0 && (
              <WarnBanner>
                {t("board.nsq.cluster.advertiseMismatch", { addresses: unreachable.join(", ") })}
              </WarnBanner>
            )}

            <div className="px-5">
              <div className={KPI_GRID}>
                <StatTile
                  label={t("board.nsq.cluster.nodes")}
                  value={String(overview?.totalNodes ?? 0)}
                />
                <StatTile
                  label={t("board.nsq.cluster.online")}
                  value={String(overview?.onlineNodes ?? 0)}
                />
                <StatTile
                  label={t("board.nsq.cluster.topics")}
                  value={formatCount(overview?.destinations ?? 0)}
                />
                <StatTile
                  label={t("board.nsq.cluster.channels")}
                  value={formatCount(overview?.subscriptions ?? 0)}
                />
                <StatTile
                  label={t("board.nsq.cluster.depth")}
                  value={formatCount(Number(overview?.attributes?.depth ?? 0))}
                />
                <StatTile
                  label={t("board.nsq.cluster.clients")}
                  value={formatCount(Number(overview?.attributes?.clientCount ?? 0))}
                />
              </div>
            </div>
          </div>

          <ListArea>
            <ListPane>
              <SectionLabel className="px-5 pb-2">{t("board.nsq.cluster.nsqd")}</SectionLabel>
              <Table inset>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.nsq.cluster.address")}</TableHead>
                    <TableHead>{t("board.nsq.cluster.version")}</TableHead>
                    <TableHead className="num">{t("board.nsq.cluster.topics")}</TableHead>
                    <TableHead className="num">{t("board.nsq.cluster.channels")}</TableHead>
                    <TableHead className="num">{t("board.nsq.cluster.clients")}</TableHead>
                    <TableHead className="num">{t("board.nsq.cluster.depth")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((entry) => (
                    <TableRow
                      key={entry.address}
                      selected={selected === entry.address}
                      onClick={() => setSelected(entry.address)}
                    >
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <span className="mono3 text-xs">{entry.address}</span>
                          {entry.status !== "online" && (
                            <Status tone="warn">
                              {entry.health || t("board.nsq.cluster.unhealthy")}
                            </Status>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>{entry.version}</TableCell>
                      <TableCell className="num">{count(entry.topics)}</TableCell>
                      <TableCell className="num">{count(entry.channels)}</TableCell>
                      <TableCell className="num">{count(entry.clients)}</TableCell>
                      <TableCell className="num">{count(entry.depth)}</TableCell>
                    </TableRow>
                  ))}
                  {nodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {t("board.nsq.cluster.noNodes")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <SectionLabel className="px-5 pt-6 pb-2">
                {t("board.nsq.cluster.lookupd")}
              </SectionLabel>
              {directory.length === 0 ? (
                <p className="px-5 pb-6 text-xs leading-relaxed text-muted-foreground">
                  {t("board.nsq.cluster.noLookupd")}
                </p>
              ) : (
                <DirectoryTable directory={directory} />
              )}
            </ListPane>

            {current != null && (
              <NodeSheet
                key={current.address}
                entry={current}
                onClose={() => setSelected(null)}
              />
            )}
          </ListArea>
        </>
      )}
    </Page>
  );
}

export function NodeSheet({ entry, onClose }: { entry: NsqNode; onClose: () => void }) {
  const { t } = useTranslation();
  const config = useNsqNodeConfig(entry.address);
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader
        title={entry.address}
        badge={
          entry.status !== "online" ? (
            <Status tone="warn">{entry.health || t("board.nsq.cluster.unhealthy")}</Status>
          ) : undefined
        }
        onClose={onClose}
      />
      <DetailPanelBody>
        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.cluster.section.identity")}</SectionLabel>
          <KV
            rows={[
              [t("board.nsq.cluster.hostname"), entry.hostname || DASH],
              [t("board.nsq.cluster.broadcast"), entry.broadcastAddress || DASH],
              [t("board.nsq.cluster.tcpPort"), entry.tcpPort || DASH],
              [t("board.nsq.cluster.httpPort"), entry.httpPort || DASH],
              [t("board.nsq.cluster.health"), entry.health || DASH],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.cluster.section.memory")}</SectionLabel>
          <KV
            rows={[
              [
                t("board.nsq.cluster.heapInUse"),
                entry.heapInUse == null ? DASH : formatBytes(entry.heapInUse),
              ],
              [t("board.nsq.cluster.heapObjects"), count(entry.heapObjects)],
              [t("board.nsq.cluster.gcRuns"), count(entry.gcRuns)],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">{t("board.nsq.cluster.section.config")}</SectionLabel>
          <KV
            rows={Object.entries(config.data ?? {}).map(([key, value]) => [key, value ?? DASH])}
          />
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            {t("board.nsq.cluster.configNote")}
          </p>
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}

function DirectoryTable({ directory }: { directory: NsqDirectoryNode[] }) {
  const { t } = useTranslation();
  return (
    <Table inset>
      <TableHeader>
        <TableRow>
          <TableHead>{t("board.nsq.cluster.address")}</TableHead>
          <TableHead>{t("board.nsq.cluster.version")}</TableHead>
          <TableHead className="num">{t("board.nsq.cluster.producers")}</TableHead>
          <TableHead className="num">{t("board.nsq.cluster.knownTopics")}</TableHead>
          <TableHead>{t("board.nsq.cluster.advertises")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {directory.map((entry) => (
          <TableRow key={entry.address}>
            <TableCell className="mono3 text-xs">{entry.address}</TableCell>
            <TableCell>{entry.version}</TableCell>
            <TableCell className="num">{count(entry.producers)}</TableCell>
            <TableCell className="num">{count(entry.topics)}</TableCell>
            <TableCell className="mono3 text-xs">{entry.advertises.join(", ") || DASH}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
