import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  MiniStat,
  MiniTable,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Sw,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.overview", "board.common.members", "board.consumers.rocketmq.subRel", "board.common.offset"] as const;
const R = { textAlign: "right" } as const;
const DIM = { textAlign: "right", color: "var(--c-muted)" } as const;

/** Board 9a — RocketMQ consumer groups. */
export function ConsumersRocketMQ() {
  const [backlogOnly, setBacklogOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.consumerGroup")} subtitle={t("board.consumers.rocketmq.subtitle")} />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder={t("board.common.searchGroups")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={backlogOnly} onCheckedChange={setBacklogOnly} label={t("board.consumers.rocketmq.backlogOnly")} />
          {t("board.consumers.rocketmq.backlogOnly")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.common.sortByBacklog")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>{t("board.consumers.rocketmq.groupName")}</TH>
                <TH style={R}>{t("board.consumers.rocketmq.subTopic")}</TH>
                <TH>{t("board.common.mode")}</TH>
                <TH style={R}>{t("board.common.consumeTps")}</TH>
                <TH style={R}>{t("board.common.backlog")}</TH>
                <TH style={R}>{t("board.common.latency")}</TH>
                <TH>{t("board.common.status")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "order-settle"} onClick={() => setSelected("order-settle")}>
                <TD><b style={{ fontWeight: 500 }}>order-settle</b></TD>
                <TD className="mono3" style={R}>1</TD>
                <TD>{t("board.common.cluster")}</TD>
                <TD className="mono3" style={R}>1 104</TD>
                <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={R}>2.1s</TD>
                <TD><Status tone="warn">{t("board.common.backlogAlert")}</Status></TD>
              </TR>
              <TR selected={selected === "order-notify"} onClick={() => setSelected("order-notify")}>
                <TD>order-notify</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD>{t("board.common.cluster")}</TD>
                <TD className="mono3" style={R}>2 003</TD>
                <TD className="mono3" style={R}>120</TD>
                <TD className="mono3" style={R}>0.3s</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
              <TR selected={selected === "risk-audit"} onClick={() => setSelected("risk-audit")}>
                <TD>risk-audit</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD>{t("board.common.cluster")}</TD>
                <TD className="mono3" style={R}>880</TD>
                <TD className="mono3" style={R}>41</TD>
                <TD className="mono3" style={R}>0.1s</TD>
                <TD><Status tone="ok">{t("board.common.healthy")}</Status></TD>
              </TR>
              <TR selected={selected === "push-broadcast"} onClick={() => setSelected("push-broadcast")}>
                <TD style={{ color: "var(--c-muted)" }}>push-broadcast</TD>
                <TD className="mono3" style={DIM}>1</TD>
                <TD style={{ color: "var(--c-muted)" }}>{t("board.consumers.rocketmq.broadcast")}</TD>
                <TD className="mono3" style={DIM}>45</TD>
                <TD className="mono3" style={DIM}>—</TD>
                <TD className="mono3" style={DIM}>—</TD>
                <TD><Status tone="off">{t("board.common.healthy")}</Status></TD>
              </TR>
              <SkeletonRows colSpan={7} widths={["70%", "56%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="warn" style={{ fontSize: "10px" }}>{t("board.consumers.rocketmq.backlog982")}</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <MiniStat label={t("board.common.backlog")} value="982" color="var(--c-warn-text)" />
                <MiniStat label={t("board.common.consumeTps")} value="1 104" />
                <MiniStat label={t("board.common.client")} value="4" />
              </div>

              <KV
                rows={[
                  [t("board.common.subscription"), <span className="mono3" style={{ fontSize: "11px" }}>ORDER_CREATE · TAG: create||paid</span>],
                  [t("board.common.mode"), t("board.consumers.rocketmq.clusterConcurrent")],
                  [t("board.consumers.rocketmq.retryPolicy"), t("board.consumers.rocketmq.retryValue")],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rocketmq.onlineClients")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>ClientId</TH>
                        <TH style={R}>{t("board.consumers.rocketmq.assignedQueues")}</TH>
                        <TH style={R}>{t("board.common.backlog")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">settle-77@10.2.3.4</TD>
                        <TD className="mono3" style={R}>q0–q7</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>812</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">settle-78@10.2.3.5</TD>
                        <TD className="mono3" style={R}>q8–q15</TD>
                        <TD className="mono3" style={R}>170</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.consumers.rocketmq.backlogHint")}
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.resetOffset")}</Btn>
              <Btn>{t("board.consumers.rocketmq.viewDlq")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.deleteGroup")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}

