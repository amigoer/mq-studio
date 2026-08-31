import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DetailPanelFooter,
  DetailPanelHeader,
  MiniStat,
  Panel,
  SectionLabel,
  Status,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useKafkaGroupDetail, useKafkaGroups } from "@/hooks/kafka/useKafkaGroups";
import { deleteKafkaGroup } from "@/api/kafka";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import {
  assignor,
  coordinator,
  hasCommitted,
  hasMembers,
  isEmpty,
  isRebalancing,
  state,
  topics as groupTopics,
  totalLag,
} from "@/mq/kafka/subscriptions";
import { ResetOffsetDialogKafka } from "./ResetOffsetDialogKafka";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

const TAB_ASSIGNMENT = "board.consumers.kafka.assignment";
const TAB_MEMBERS = "board.common.members";
const SHEET_TABS = [TAB_ASSIGNMENT, TAB_MEMBERS] as const;

function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 14a — Kafka consumer groups.
 *
 * The consume-rate column the canvas drew is gone: Kafka's admin protocol
 * reports no rate, and a group's throughput is a JMX metric on the consumer
 * rather than something the cluster knows.
 *
 * What the canvas did not draw and this does is the group's state as a
 * first-class fact. Empty - offsets committed, nothing connected - is either a
 * gap between deployments or a consumer that died leaving a backlog growing,
 * and nothing in the protocol says which. The board names it and lets the
 * reader decide, which is more use than folding it into "offline".
 */
export function ConsumersKafka() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [lagOnly, setLagOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(TAB_ASSIGNMENT);
  const [resetting, setResetting] = useState(false);

  const state_ = useKafkaGroups();
  const detail = useKafkaGroupDetail(selected);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state_.data ?? [])
      .filter((group) => term === "" || group.ref.name.toLowerCase().includes(term))
      .filter((group) => !lagOnly || (totalLag(group) ?? 0) > 0)
      .sort((left, right) => left.ref.name.localeCompare(right.ref.name));
  }, [state_.data, search, lagOnly]);

  const current = rows.find((group) => group.ref.name === selected) ?? null;

  const remove = async (group: string) => {
    const ok = await confirm({
      title: t("board.consumers.kafka.deleteTitle", { group }),
      description: t("board.consumers.kafka.deleteBody"),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteKafkaGroup(connID, group);
      setSelected(null);
      await state_.refresh();
      toast.success(t("board.consumers.kafka.deleted", { group }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  const partitions = detail.data?.partitions ?? [];
  const members = detail.data?.members ?? [];

  return (
    <Page>
      <PageHeader
        title={t("board.common.consumerGroup")}
        subtitle={t("board.consumers.kafka.subtitle")}
        actions={
          <RefreshButton
            refreshing={state_.refreshing}
            online={state_.online}
            onClick={() => void state_.refresh()}
          />
        }
      />
      <Toolbar>
        <Input
          className="w-[220px] flex-none"
          placeholder={t("board.common.searchGroups")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={lagOnly} onCheckedChange={setLagOnly} />
          {t("board.consumers.kafka.lagOnly")}
        </span>
        <span className="flex-1" />
      </Toolbar>

      <BoardState state={state_} empty={rows.length === 0 ? <Empty /> : undefined}>
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                  <TableHead style={R}>{t("board.common.members")}</TableHead>
                  <TableHead style={R}>Topic</TableHead>
                  <TableHead style={R}>{t("board.consumers.kafka.totalLag")}</TableHead>
                  <TableHead>{t("board.consumers.kafka.strategy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((group) => (
                  <TableRow
                    key={group.ref.name}
                    selected={selected === group.ref.name}
                    onClick={() => setSelected(group.ref.name)}
                  >
                    <TableCell>
                      <b style={{ fontWeight: 500 }}>{group.ref.name}</b>
                    </TableCell>
                    <TableCell>
                      <GroupState group={group} />
                    </TableCell>
                    <TableCell className="mono3" style={R}>{group.members}</TableCell>
                    <TableCell className="mono3" style={R}>{group.destinations}</TableCell>
                    <TableCell
                      className="mono3"
                      style={{ ...R, color: (totalLag(group) ?? 0) > 0 ? "var(--c-warn-text)" : undefined }}
                    >
                      {reported(totalLag(group))}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {assignor(group) === "" ? "—" : assignor(group)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {selected != null && current != null && (
            <DetailPanel width={440} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={selected}
                badge={<GroupState group={current} />}
                tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
                activeTab={tab}
                onTabChange={setTab}
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <MiniStat
                    label={t("board.consumers.kafka.totalLag")}
                    value={reported(totalLag(current))}
                    color={(totalLag(current) ?? 0) > 0 ? "var(--c-warn-text)" : undefined}
                    size={15}
                  />
                  <MiniStat label={t("board.common.members")} value={String(current.members)} size={15} />
                  <MiniStat
                    label={t("board.consumers.kafka.coordinator")}
                    value={coordinator(current) === "" ? "—" : coordinator(current)}
                    size={15}
                  />
                </div>

                <BoardState state={detail}>
                  {tab === TAB_ASSIGNMENT ? (
                    <div>
                      <SectionLabel style={{ marginBottom: "6px" }}>
                        {t("board.consumers.kafka.partitionLag")}
                      </SectionLabel>
                      <Panel style={{ overflow: "hidden" }}>
                        <Table className="text-xs">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Topic</TableHead>
                              <TableHead style={R}>P</TableHead>
                              <TableHead>member</TableHead>
                              <TableHead style={R}>committed</TableHead>
                              <TableHead style={R}>end</TableHead>
                              <TableHead style={R}>lag</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {partitions.map((row) => (
                              <TableRow key={`${row.topic}/${row.partition}`}>
                                <TableCell className="mono3" style={MONO11}>{row.topic}</TableCell>
                                <TableCell className="mono3" style={R}>{row.partition}</TableCell>
                                <TableCell className="mono3" style={MONO11}>
                                  {row.member === "" ? (
                                    <span style={{ color: "var(--c-muted)" }}>
                                      {t("board.consumers.kafka.unheld")}
                                    </span>
                                  ) : (
                                    row.member
                                  )}
                                </TableCell>
                                <TableCell className="mono3" style={R}>
                                  {/* -1 is "never committed", the opposite end
                                      of the log from offset 0. */}
                                  {hasCommitted(row) ? (
                                    row.committed
                                  ) : (
                                    <span style={{ color: "var(--c-muted)" }}>
                                      {t("board.consumers.kafka.neverRead")}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="mono3" style={R}>{row.end}</TableCell>
                                <TableCell
                                  className="mono3"
                                  style={{ ...R, color: row.lag > 0 ? "var(--c-warn-text)" : undefined }}
                                >
                                  {row.lag < 0 ? "—" : row.lag}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Panel>
                    </div>
                  ) : (
                    <div>
                      <SectionLabel style={{ marginBottom: "6px" }}>
                        {t("board.common.members")}
                      </SectionLabel>
                      {members.length === 0 ? (
                        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                          {t("board.consumers.kafka.noMembers")}
                        </span>
                      ) : (
                        <Panel style={{ overflow: "hidden" }}>
                          <Table className="text-xs">
                            <TableHeader>
                              <TableRow>
                                <TableHead>client</TableHead>
                                <TableHead>host</TableHead>
                                <TableHead style={R}>{t("board.consumers.kafka.holds")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {members.map((member) => (
                                <TableRow key={member.memberId}>
                                  <TableCell className="mono3" style={MONO11}>
                                    {member.clientId}
                                    {member.instanceId !== "" && (
                                      <span style={{ color: "var(--c-muted)" }}>
                                        {" "}
                                        ({member.instanceId})
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="mono3" style={MONO11}>
                                    {member.clientHost}
                                  </TableCell>
                                  <TableCell className="mono3" style={R}>
                                    {member.assigned.length}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Panel>
                      )}
                    </div>
                  )}
                </BoardState>
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button
                  variant="outline"
                  disabled={hasMembers(current)}
                  title={hasMembers(current) ? t("board.consumers.kafka.resetNeedsStop") : undefined}
                  onClick={() => setResetting(true)}
                >
                  {t("board.consumers.kafka.resetOffset")}
                </Button>
                <span className="flex-1" />
                <Button variant="destructive" onClick={() => void remove(selected)}>
                  {t("board.common.deleteGroup")}
                </Button>
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>

      {current != null && (
        <ResetOffsetDialogKafka
          open={resetting}
          group={current.ref.name}
          topics={groupTopics(current)}
          hasMembers={hasMembers(current)}
          onClose={() => setResetting(false)}
          onReset={() => {
            void state_.refresh();
            void detail.refresh();
          }}
        />
      )}
    </Page>
  );
}

function GroupState({ group }: { group: import("@/api/models").Subscription }) {
  const { t } = useTranslation();
  const label = state(group);
  if (label === "") return <Status tone="off">—</Status>;
  if (isRebalancing(group)) return <Status tone="warn">{label}</Status>;
  if (isEmpty(group)) {
    return <Status tone="warn" title={t("board.consumers.kafka.emptyHint")}>{label}</Status>;
  }
  if (label === "Dead") return <Status tone="off">{label}</Status>;
  return <Status tone="ok">{label}</Status>;
}

function Empty() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: "24px", fontSize: "12px", color: "var(--c-muted)" }}>
      {t("board.consumers.kafka.empty")}
    </div>
  );
}
