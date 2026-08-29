import { useState } from "react";
import { ArrowRight } from "lucide-react";
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
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.overview", "board.common.bindings", "board.common.consumers", "board.common.params"] as const;
const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 4a — RabbitMQ queues. AMQP has no topic to map onto, so this is its
 * own module rather than an adaptation of the topic page.
 */
export function QueuesRabbitMQ() {
  const [backlogOnly, setBacklogOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.common.queue")}
        subtitle={t("board.topics.rabbitmq.queueSubtitle")}
        actions={<Btn variant="primary">{t("board.topics.rabbitmq.newQueue")}</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 220px" }} placeholder={t("board.topics.rabbitmq.searchQueue")} />
        <SelectField value="vhost：/order" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={backlogOnly} onCheckedChange={setBacklogOnly} label={t("board.topics.rabbitmq.backlogOnly")} />
          {t("board.topics.rabbitmq.backlogOnly")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.topics.rabbitmq.sortByReady")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>{t("board.common.queue")}</TH>
                <TH>{t("board.common.type")}</TH>
                <TH style={{ textAlign: "right" }}>Ready</TH>
                <TH style={{ textAlign: "right" }}>Unacked</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.consumers")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.topics.rabbitmq.inOutRate")}</TH>
                <TH>{t("board.common.features")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "order.settle.q"} onClick={() => setSelected("order.settle.q")}>
                <TD><b style={{ fontWeight: 500 }}>order.settle.q</b></TD>
                <TD>quorum</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>14</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104 / 1 010</TD>
                <TD>
                  <Status tone="off" style={TAG}>DLX</Status>{" "}
                  <Status tone="off" style={TAG}>TTL</Status>
                </TD>
              </TR>
              <TR selected={selected === "order.notify.q"} onClick={() => setSelected("order.notify.q")}>
                <TD>order.notify.q</TD>
                <TD>classic</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>6</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003 / 2 001</TD>
                <TD><Status tone="off" style={TAG}>DLX</Status></TD>
              </TR>
              <TR selected={selected === "audit.pipeline.q"} onClick={() => setSelected("audit.pipeline.q")}>
                <TD>audit.pipeline.q</TD>
                <TD>stream</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>120</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880 / 875</TD>
                <TD />
              </TR>
              <TR selected={selected === "dlx.order.q"} onClick={() => setSelected("dlx.order.q")}>
                <TD style={{ color: "var(--c-muted)" }}>dlx.order.q</TD>
                <TD style={{ color: "var(--c-muted)" }}>classic</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-err-text)" }}>37</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0.2 / 0</TD>
                <TD><Status tone="err" style={TAG}>{t("board.common.deadLetter")}</Status></TD>
              </TR>
              <SkeletonRows colSpan={7} widths={["74%", "60%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={370} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<ProtoBadge protocol="rabbitmq" label="quorum" />}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>Ready</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px", color: "var(--c-warn-text)" }}>
                    982
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>Unacked</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}>14</div>
                </Card>
              </div>

              <KV
                rows={[
                  [t("board.common.persistence"), "durable"],
                  [t("board.topics.rabbitmq.messageTtl"), <span className="mono3" style={MONO11}>30 000 ms</span>],
                  [t("board.topics.rabbitmq.dlx"), <span className="mono3" style={MONO11}>dlx.order</span>],
                  [t("board.topics.rabbitmq.exclusiveAutoDelete"), t("board.topics.rabbitmq.noNo")],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.common.bindings")}</SectionLabel>
                <Card
                  style={{
                    padding: "9px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    fontSize: "11.5px",
                  }}
                >
                  <BindingRow routingKey="order.created" />
                  <BindingRow routingKey="order.updated" />
                </Card>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.topics.rabbitmq.browseHead")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.purge")}</Btn>
              <Btn variant="danger">{t("board.common.delete")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}

function BindingRow({ routingKey }: { routingKey: string }) {
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      <ProtoBadge protocol="rabbitmq" label="topic" style={{ fontSize: "9px" }} />
      <span className="mono3" style={MONO11}>ex.order</span>
      <ArrowRight size={12} style={{ color: "var(--c-muted-2)", flex: "none" }} aria-hidden />
      <span className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>rk = {routingKey}</span>
    </div>
  );
}
