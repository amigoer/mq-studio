import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
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
  Panel,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
} from "@/components";
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
        actions={<Button>{t("board.topics.rabbitmq.newExchange")}</Button>}
      />
      <Toolbar>
        <Input className="w-[200px] flex-none" placeholder={t("board.topics.rabbitmq.searchExchange")} />
        <Segmented options={TYPES.map((o) => ({ ...o, label: t(o.label) }))} value={type} onChange={setType} />
        <span className="flex-1" />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={showAmq} onCheckedChange={setShowAmq} />
          {t("board.topics.rabbitmq.showAmq")}
        </span>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.exchange")}</TableHead>
                <TableHead>{t("board.common.type")}</TableHead>
                <TableHead>{t("board.common.features")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.bindings")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.inRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "ex.order"} onClick={() => setSelected("ex.order")}>
                <TableCell>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>ex.order</b>
                </TableCell>
                <TableCell>topic</TableCell>
                <TableCell><Status tone="off" style={TAG}>durable</Status></TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>6</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2 980/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "ex.notify"} onClick={() => setSelected("ex.notify")}>
                <TableCell className="mono3" style={NAME}>ex.notify</TableCell>
                <TableCell>fanout</TableCell>
                <TableCell><Status tone="off" style={TAG}>durable</Status></TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2 003/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "dlx.order"} onClick={() => setSelected("dlx.order")}>
                <TableCell className="mono3" style={NAME}>dlx.order</TableCell>
                <TableCell>direct</TableCell>
                <TableCell>
                  <Status tone="off" style={TAG}>durable</Status>{" "}
                  <Status tone="err" style={TAG}>DLX</Status>
                </TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0.2/s</TableCell>
              </TableRow>
              <SkeletonRows colSpan={5} widths={["58%", "44%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={390} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={TAG}>topic</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rabbitmq.bindingsCount")}</SectionLabel>
                <Panel style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("board.common.target")}</TableHead>
                        <TableHead>routing key</TableHead>
                        <TableHead style={{ textAlign: "right" }} />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {BINDINGS.map((b) => (
                        <TableRow key={`${b.target}-${b.key}`}>
                          <TableCell className="mono3">{b.target}</TableCell>
                          <TableCell className="mono3">{b.key}</TableCell>
                          <TableCell style={{ textAlign: "right", color: "var(--c-muted)" }}>{t("board.topics.rabbitmq.unbind")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Panel>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.rabbitmq.addBinding")}</SectionLabel>
                <div style={{ display: "flex", gap: "8px" }}>
                  <SelectField
                    className="flex-1"
                    value="queue"
                    options={[{ value: "queue", label: t("board.common.queue") }]}
                  />
                  <Input className="mono3 flex-1 text-xs" placeholder="routing key" />
                  <Button variant="outline">{t("board.common.bindings")}</Button>
                </div>
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.topics.rabbitmq.publishTest")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.delete")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
