import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
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

const SHEET_TABS = ["board.consumers.kafka.assignment", "board.common.members", "board.common.offset"] as const;
const R = { textAlign: "right" } as const;

/** Board 14a — Kafka consumer groups; Rebalancing is a first-class state. */
export function ConsumersKafka() {
  const [lagOnly, setLagOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.consumerGroup")} subtitle={t("board.consumers.kafka.subtitle")} />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder={t("board.common.searchGroups")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={lagOnly} onCheckedChange={setLagOnly} label={t("board.consumers.kafka.lagOnly")} />
          {t("board.consumers.kafka.lagOnly")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.consumers.kafka.sortByLag")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Group</TH>
                <TH>{t("board.common.status")}</TH>
                <TH style={R}>{t("board.common.members")}</TH>
                <TH style={R}>Topic</TH>
                <TH style={R}>{t("board.consumers.kafka.totalLag")}</TH>
                <TH style={R}>{t("board.common.consumeRate")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "settle-consumer"} onClick={() => setSelected("settle-consumer")}>
                <TD><b style={{ fontWeight: 500 }}>settle-consumer</b></TD>
                <TD><Status tone="ok">Stable</Status></TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>9 820</TD>
                <TD className="mono3" style={R}>1 104/s</TD>
              </TR>
              <TR selected={selected === "notify-consumer"} onClick={() => setSelected("notify-consumer")}>
                <TD>notify-consumer</TD>
                <TD><Status tone="ok">Stable</Status></TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={R}>1 220</TD>
                <TD className="mono3" style={R}>2 003/s</TD>
              </TR>
              <TR selected={selected === "audit-pipeline"} onClick={() => setSelected("audit-pipeline")}>
                <TD>audit-pipeline</TD>
                <TD><Status tone="warn">Rebalancing</Status></TD>
                <TD className="mono3" style={R}>3→4</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={R}>840</TD>
                <TD className="mono3" style={R}>—</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["66%", "50%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>Stable</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <MiniStat label={t("board.consumers.kafka.totalLag")} value="9 820" color="var(--c-warn-text)" size={15} />
                <MiniStat label={t("board.common.members")} value="6" size={15} />
                <MiniStat label={t("board.consumers.kafka.strategy")} value="range" size={15} />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.kafka.partitionLag")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH style={R}>P</TH>
                        <TH>member</TH>
                        <TH style={R}>committed</TH>
                        <TH style={R}>end</TH>
                        <TH style={R}>lag</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3" style={R}>0</TD>
                        <TD className="mono3">c-1@10.2.3.4</TD>
                        <TD className="mono3" style={R}>88 199 021</TD>
                        <TD className="mono3" style={R}>88 204 771</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>5 750</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>1</TD>
                        <TD className="mono3">c-1@10.2.3.4</TD>
                        <TD className="mono3" style={R}>88 201 990</TD>
                        <TD className="mono3" style={R}>88 204 018</TD>
                        <TD className="mono3" style={R}>2 028</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>2</TD>
                        <TD className="mono3">c-2@10.2.3.5</TD>
                        <TD className="mono3" style={R}>88 202 771</TD>
                        <TD className="mono3" style={R}>88 204 813</TD>
                        <TD className="mono3" style={R}>2 042</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>{t("board.consumers.kafka.lagHint")}</div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.consumers.kafka.resetOffset")}</Btn>
              <Btn>{t("board.consumers.kafka.exportLag")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.deleteGroup")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
