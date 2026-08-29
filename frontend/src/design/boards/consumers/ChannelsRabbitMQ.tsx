import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
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

const SHEET_TABS = ["board.common.channel", "board.common.properties"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 14e — RabbitMQ has no consumer groups, so the slot becomes the
 * connection → channel → consumer tree. prefetch vs unacked locates a stall.
 */
export function ChannelsRabbitMQ() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.consumers.rabbitmq.title")} subtitle={t("board.consumers.rabbitmq.subtitle")} />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder={t("board.consumers.rabbitmq.search")} />
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.consumers.rabbitmq.sortByUnacked")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>{t("board.common.connections")}</TH>
                <TH>{t("board.common.user")}</TH>
                <TH style={R}>{t("board.common.channel")}</TH>
                <TH>{t("board.common.status")}</TH>
                <TH style={R}>{t("board.consumers.rabbitmq.rxTx")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "10.2.3.4:52210"} onClick={() => setSelected("10.2.3.4:52210")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>10.2.3.4:52210</b>
                </TD>
                <TD>settle-svc</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD><Status tone="warn">flow</Status></TD>
                <TD className="mono3" style={R}>1 104 / 0 msg/s</TD>
              </TR>
              <TR selected={selected === "10.2.3.5:52344"} onClick={() => setSelected("10.2.3.5:52344")}>
                <TD className="mono3" style={NAME}>10.2.3.5:52344</TD>
                <TD>settle-svc</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD><Status tone="ok">running</Status></TD>
                <TD className="mono3" style={R}>998 / 0</TD>
              </TR>
              <TR selected={selected === "10.2.4.1:41022"} onClick={() => setSelected("10.2.4.1:41022")}>
                <TD className="mono3" style={NAME}>10.2.4.1:41022</TD>
                <TD>order-svc</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD><Status tone="ok">running</Status></TD>
                <TD className="mono3" style={R}>0 / 2 980</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["60%", "44%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="warn" style={{ fontSize: "10px" }}>flow</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.rabbitmq.channelsCount")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH style={R}>#</TH>
                        <TH>consumer tag</TH>
                        <TH style={R}>prefetch</TH>
                        <TH style={R}>unacked</TH>
                        <TH style={R}>ack/s</TH>
                      </TR>
                    </THead>
                    <TBody>
                      <TR>
                        <TD className="mono3" style={R}>1</TD>
                        <TD className="mono3">ctag-settle-1</TD>
                        <TD className="mono3" style={R}>50</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>50</TD>
                        <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>0</TD>
                      </TR>
                      <TR>
                        <TD className="mono3" style={R}>2</TD>
                        <TD className="mono3">ctag-settle-2</TD>
                        <TD className="mono3" style={R}>50</TD>
                        <TD className="mono3" style={R}>12</TD>
                        <TD className="mono3" style={R}>280</TD>
                      </TR>
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-warn-text)" }}>
                {t("board.consumers.rabbitmq.stallWarn")}
              </div>

              <KV
                rows={[
                  [t("board.common.client"), <span className="mono3" style={MONO11}>java-amqp-client 5.20</span>],
                  [t("board.consumers.rabbitmq.heartbeat"), "60s"],
                  ["TLS", "TLSv1.3"],
                ]}
              />
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.consumers.rabbitmq.viewQueues")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.consumers.rabbitmq.closeConnection")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
