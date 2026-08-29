import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Sw,
  MiniTable,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.overview", "board.common.queue", "board.topics.rocketmq.route", "board.common.subscription", "board.common.config"] as const;

/**
 * Board 3c — RocketMQ topics. The detail panel is a floating sheet rather than
 * a third column, so opening it never reflows the table's column widths.
 */
export function TopicsRocketMQ() {
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.rocketmq.subtitle")}
        actions={<Btn variant="primary">{t("board.common.newTopic")}</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 240px" }} placeholder={t("board.common.searchTopic")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showSystem} onCheckedChange={setShowSystem} label={t("board.topics.rocketmq.showSystem")} />
          {t("board.topics.rocketmq.showSystem")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.common.sortByBacklog")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>{t("board.topics.rocketmq.queueRW")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.produceTps")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.topics.rocketmq.todayVolume")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.backlog")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "ORDER_CREATE"} onClick={() => setSelected("ORDER_CREATE")}>
                <TD>
                  <b style={{ fontWeight: 500 }}>ORDER_CREATE</b>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>16 / 16</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8.2M</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
              </TR>
              <TR selected={selected === "ORDER_PAY_DELAY"} onClick={() => setSelected("ORDER_PAY_DELAY")}>
                <TD>ORDER_PAY_DELAY</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8 / 8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>320</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2.1M</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR selected={selected === "USER_REGISTER"} onClick={() => setSelected("USER_REGISTER")}>
                <TD>USER_REGISTER</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8 / 8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>45</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>380K</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
              </TR>
              <TR selected={selected === "%RETRY%order-settle"} onClick={() => setSelected("%RETRY%order-settle")}>
                <TD style={{ color: "var(--c-muted)" }}>%RETRY%order-settle</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1 / 1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>12</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>9.4K</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>37</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["72%", "58%", "80%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<ProtoBadge protocol="rocketmq" label="RMQ 5.x" />}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.common.produceTps")}</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}>
                    1 104
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.common.backlog")}</div>
                  <div
                    className="mono3"
                    style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px", color: "var(--c-warn-text)" }}
                  >
                    982
                  </div>
                </Card>
              </div>

              <KV
                rows={[
                  [t("board.topics.rocketmq.perm"), t("board.topics.rocketmq.readWrite")],
                  [t("board.topics.rocketmq.messageType"), t("board.topics.rocketmq.normal")],
                  [t("board.topics.rocketmq.created"), <span className="mono3" style={{ fontSize: "11px" }}>2026-03-14 11:02</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.queueSpread")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>Broker</TH>
                        <TH style={{ textAlign: "right" }}>{t("board.common.queue")}</TH>
                        <TH style={{ textAlign: "right" }}>{t("board.topics.rocketmq.maxOffset")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3">broker-a</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>q0–q7</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>1 204 771</TD>
                      </TR>
                      <TR>
                        <TD className="mono3">broker-b</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>q8–q15</TD>
                        <TD className="mono3" style={{ textAlign: "right" }}>1 198 042</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rocketmq.subGroups")}</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="warn">{t("board.topics.rocketmq.settleBacklog")}</Status>
                  <Status tone="ok">order-notify</Status>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.viewMessages")}</Btn>
              <Btn>{t("board.common.sendMessage")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.delete")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
