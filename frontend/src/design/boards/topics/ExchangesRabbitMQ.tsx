import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  MiniTable,
  SectionLabel,
  Seg,
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

const SHEET_TABS = ["board.common.bindings", "board.common.overview", "board.common.params"] as const;
const TAG = { fontSize: "10px" } as const;
const NAME = { fontSize: "11.5px" } as const;

const TYPES = [
  { value: "all", label: "board.common.all" },
  { value: "topic", label: "board.term.topic" },
  { value: "direct", label: "board.term.direct" },
  { value: "fanout", label: "board.term.fanout" },
  { value: "headers", label: "board.term.headersType" },
] as const;

const BINDINGS = [
  { target: "order.settle.q", key: "order.created" },
  { target: "order.settle.q", key: "order.updated" },
  { target: "order.notify.q", key: "order.#" },
  { target: "audit.pipeline.q", key: "#" },
];

/** Board 12c — RabbitMQ exchanges. AMQP-only page; the sheet is the binding list. */
export function ExchangesRabbitMQ() {
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("all");
  const [showAmq, setShowAmq] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title={t("board.common.exchange")}
        subtitle={t("board.topics.rabbitmq.exchangeSubtitle")}
        actions={<Btn variant="primary">{t("board.topics.rabbitmq.newExchange")}</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 200px" }} placeholder={t("board.topics.rabbitmq.searchExchange")} />
        <Seg options={TYPES.map((o) => ({ ...o, label: t(o.label) }))} value={type} onChange={setType} />
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showAmq} onCheckedChange={setShowAmq} label={t("board.topics.rabbitmq.showAmq")} />
          {t("board.topics.rabbitmq.showAmq")}
        </span>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>{t("board.common.exchange")}</TH>
                <TH>{t("board.common.type")}</TH>
                <TH>{t("board.common.features")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.bindings")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.inRate")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "ex.order"} onClick={() => setSelected("ex.order")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>ex.order</b>
                </TD>
                <TD>topic</TD>
                <TD><Status tone="off" style={TAG}>durable</Status></TD>
                <TD className="mono3" style={{ textAlign: "right" }}>6</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 980/s</TD>
              </TR>
              <TR selected={selected === "ex.notify"} onClick={() => setSelected("ex.notify")}>
                <TD className="mono3" style={NAME}>ex.notify</TD>
                <TD>fanout</TD>
                <TD><Status tone="off" style={TAG}>durable</Status></TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2 003/s</TD>
              </TR>
              <TR selected={selected === "dlx.order"} onClick={() => setSelected("dlx.order")}>
                <TD className="mono3" style={NAME}>dlx.order</TD>
                <TD>direct</TD>
                <TD>
                  <Status tone="off" style={TAG}>durable</Status>{" "}
                  <Status tone="err" style={TAG}>DLX</Status>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>0.2/s</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["58%", "44%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={TAG}>topic</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rabbitmq.bindingsCount")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <THead>
                      <TR>
                        <TH>{t("board.common.target")}</TH>
                        <TH>routing key</TH>
                        <TH style={{ textAlign: "right" }} />
                      </TR>
                    </THead>
                    <TBody>
                      {BINDINGS.map((b) => (
                        <TR key={`${b.target}-${b.key}`}>
                          <TD className="mono3">{b.target}</TD>
                          <TD className="mono3">{b.key}</TD>
                          <TD style={{ textAlign: "right", color: "var(--c-muted)" }}>{t("board.topics.rabbitmq.unbind")}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rabbitmq.addBinding")}</SectionLabel>
                <div style={{ display: "flex", gap: "8px" }}>
                  <SelectField style={{ flex: 1 }} value={t("board.common.queue")} />
                  <Field className="mono3" style={{ flex: 1, fontSize: "11px" }} placeholder="routing key" />
                  <Btn>{t("board.common.bindings")}</Btn>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.topics.rabbitmq.publishTest")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.delete")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
