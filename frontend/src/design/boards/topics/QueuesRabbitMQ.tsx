import { useState } from "react";
import { ArrowRight } from "lucide-react";
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
  KV,
  Panel,
  ProtoBadge,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
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
        actions={<Button>{t("board.topics.rabbitmq.newQueue")}</Button>}
      />
      <Toolbar>
        <Input className="w-[220px] flex-none" placeholder={t("board.topics.rabbitmq.searchQueue")} />
        <SelectField value="/order" prefix="vhost：" options={[{ value: "/order" }]} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={backlogOnly} onCheckedChange={setBacklogOnly} />
          {t("board.topics.rabbitmq.backlogOnly")}
        </span>
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.topics.rabbitmq.sortByReady") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.queue")}</TableHead>
                <TableHead>{t("board.common.type")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>Ready</TableHead>
                <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.consumers")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.topics.rabbitmq.inOutRate")}</TableHead>
                <TableHead>{t("board.common.features")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "order.settle.q"} onClick={() => setSelected("order.settle.q")}>
                <TableCell><b style={{ fontWeight: 500 }}>order.settle.q</b></TableCell>
                <TableCell>quorum</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>982</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>14</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>4</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 104 / 1 010</TableCell>
                <TableCell>
                  <Status tone="off" style={TAG}>DLX</Status>{" "}
                  <Status tone="off" style={TAG}>TTL</Status>
                </TableCell>
              </TableRow>
              <TableRow selected={selected === "order.notify.q"} onClick={() => setSelected("order.notify.q")}>
                <TableCell>order.notify.q</TableCell>
                <TableCell>classic</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>6</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2 003 / 2 001</TableCell>
                <TableCell><Status tone="off" style={TAG}>DLX</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "audit.pipeline.q"} onClick={() => setSelected("audit.pipeline.q")}>
                <TableCell>audit.pipeline.q</TableCell>
                <TableCell>stream</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>120</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880 / 875</TableCell>
                <TableCell />
              </TableRow>
              <TableRow selected={selected === "dlx.order.q"} onClick={() => setSelected("dlx.order.q")}>
                <TableCell style={{ color: "var(--c-muted)" }}>dlx.order.q</TableCell>
                <TableCell style={{ color: "var(--c-muted)" }}>classic</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-err-text)" }}>37</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>0.2 / 0</TableCell>
                <TableCell><Status tone="err" style={TAG}>{t("board.common.deadLetter")}</Status></TableCell>
              </TableRow>
              <SkeletonRows colSpan={7} widths={["74%", "60%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={370} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<ProtoBadge protocol="rabbitmq" label="quorum" />}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>Ready</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px", color: "var(--c-warn-text)" }}>
                    982
                  </div>
                </Panel>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>Unacked</div>
                  <div className="mono3" style={{ fontSize: "16px", fontWeight: 600, marginTop: "2px" }}>14</div>
                </Panel>
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
                <Panel
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
                </Panel>
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.topics.rabbitmq.browseHead")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.purge")}</Button>
              <Button variant="destructive">{t("board.common.delete")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
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
