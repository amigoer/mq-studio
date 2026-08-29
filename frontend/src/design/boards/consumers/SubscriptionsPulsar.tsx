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
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.consumers.pulsar.cursor", "board.term.consumer", "board.common.config"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 14b — Pulsar subscriptions. Cursors move by seek, not by offset reset. */
export function SubscriptionsPulsar() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.subscription")} subtitle={t("board.consumers.pulsar.subtitle")} />
      <Toolbar>
        <SelectField value={t("board.consumers.pulsar.allTopics")} />
        <Field style={{ flex: "0 0 200px" }} placeholder={t("board.consumers.pulsar.search")} />
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.common.sortByPending")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>{t("board.common.subscription")}</TH>
                <TH>Topic</TH>
                <TH>{t("board.common.type")}</TH>
                <TH style={R}>{t("board.common.pending")}</TH>
                <TH style={R}>{t("board.common.unacked")}</TH>
                <TH style={R}>{t("board.common.outRate")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "settle-sub"} onClick={() => setSelected("settle-sub")}>
                <TD><b style={{ fontWeight: 500 }}>settle-sub</b></TD>
                <TD className="mono3" style={NAME}>…/order-created</TD>
                <TD>Shared</TD>
                <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>6 210</TD>
                <TD className="mono3" style={R}>48</TD>
                <TD className="mono3" style={R}>1 104/s</TD>
              </TR>
              <TR selected={selected === "notify-sub"} onClick={() => setSelected("notify-sub")}>
                <TD>notify-sub</TD>
                <TD className="mono3" style={NAME}>…/order-created</TD>
                <TD>Key_Shared</TD>
                <TD className="mono3" style={R}>381</TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={R}>2 003/s</TD>
              </TR>
              <TR selected={selected === "audit-sub"} onClick={() => setSelected("audit-sub")}>
                <TD>audit-sub</TD>
                <TD className="mono3" style={NAME}>…/payment-captured</TD>
                <TD>Failover</TD>
                <TD className="mono3" style={R}>1 830</TD>
                <TD className="mono3" style={R}>0</TD>
                <TD className="mono3" style={R}>880/s</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["62%", "46%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>Shared</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <MiniStat label={t("board.common.pending")} value="6 210" color="var(--c-warn-text)" size={15} />
                <MiniStat label={t("board.common.unacked")} value="48" size={15} />
              </div>

              <KV
                rows={[
                  ["markDelete", <span className="mono3" style={MONO11}>812:2:0</span>],
                  ["readPosition", <span className="mono3" style={MONO11}>812:6:1</span>],
                  [t("board.consumers.pulsar.oldestUnacked"), <span className="mono3" style={MONO11}>{t("board.consumers.pulsar.oldestValue")}</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Consumer（4）</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>name</TH>
                        <TH>addr</TH>
                        <TH style={R}>{t("board.common.unacked")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">settle-1</TD>
                        <TD className="mono3">10.2.3.4</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>41</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">settle-2</TD>
                        <TD className="mono3">10.2.3.5</TD>
                        <TD className="mono3" style={R}>7</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <Btn>{t("board.consumers.pulsar.seekTime")}</Btn>
                <Btn>Seek MessageId…</Btn>
                <Btn>{t("board.consumers.pulsar.skipN")}</Btn>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn variant="danger">{t("board.consumers.pulsar.clearBacklog")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.consumers.pulsar.unsubscribe")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
