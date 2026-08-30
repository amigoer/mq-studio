import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  IND,
  JNum,
  JsonBlock,
  JStr,
  KV,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
  WarnBanner,
} from "@/components";
import { useTranslation } from "react-i18next";

const MODES = [
  { value: "requeue", label: "board.messages.rabbitmq.requeue" },
  { value: "ack", label: "board.messages.rabbitmq.ack" },
] as const;

const SHEET_TABS = ["board.term.payload", "board.term.properties"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const TAG = { fontSize: "10px" } as const;
const R = { textAlign: "right" } as const;

/**
 * Board 13b — RabbitMQ can only browse the queue head (basic.get), so the page
 * defaults to requeue and keeps the warning banner permanently visible.
 */
export function MessagesRabbitMQ() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("requeue");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.messages.rabbitmq.title")} subtitle={t("board.messages.rabbitmq.subtitle")} />
      <WarnBanner>
          <TriangleAlert size={13} style={{ flex: "none" }} aria-hidden />
          {t("board.messages.rabbitmq.ackWarn")}
        </WarnBanner>
      <Toolbar>
        <SelectField
          value="q.order.process"
          options={[{ value: "q.order.process", label: t("board.messages.rabbitmq.queue") }]}
        />
        <Input className="mono3" style={{ flex: "0 0 70px" }} defaultValue={t("board.messages.rabbitmq.ten")} />
        <Segmented options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <span className="flex-1" />
        <Button>{t("board.messages.rabbitmq.fetch")}</Button>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead style={R}>#</TableHead>
                <TableHead>routing key</TableHead>
                <TableHead>exchange</TableHead>
                <TableHead>{t("board.common.properties")}</TableHead>
                <TableHead>{t("board.messages.rabbitmq.payloadSummary")}</TableHead>
                <TableHead>{t("board.common.redeliver")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "1"} onClick={() => setSelected("1")}>
                <TableCell className="mono3" style={R}>1</TableCell>
                <TableCell className="mono3" style={MONO11}>order.created</TableCell>
                <TableCell className="mono3" style={DIM11}>ex.order</TableCell>
                <TableCell><Status tone="off" style={TAG}>persistent</Status></TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TableCell>
                <TableCell><Status tone="warn" style={TAG}>redelivered</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "2"} onClick={() => setSelected("2")}>
                <TableCell className="mono3" style={R}>2</TableCell>
                <TableCell className="mono3" style={MONO11}>order.created</TableCell>
                <TableCell className="mono3" style={DIM11}>ex.order</TableCell>
                <TableCell><Status tone="off" style={TAG}>persistent</Status></TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TableCell>
                <TableCell />
              </TableRow>
              <TableRow selected={selected === "3"} onClick={() => setSelected("3")}>
                <TableCell className="mono3" style={R}>3</TableCell>
                <TableCell className="mono3" style={MONO11}>order.updated</TableCell>
                <TableCell className="mono3" style={DIM11}>ex.order</TableCell>
                <TableCell><Status tone="off" style={TAG}>TTL 30s</Status></TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88101"…'}</TableCell>
                <TableCell />
              </TableRow>
              <SkeletonRows colSpan={6} widths={["60%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={`#${selected} · order.created`}
              badge={<Status tone="warn" style={TAG}>redelivered</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div>
                <SectionLabel
                  style={{ marginBottom: "6px" }}
                  action={
            <>
              {t("board.messages.deserialize")}
              <ChevronDown size={12} aria-hidden />
            </>
          }
                  actionColor="var(--c-fg-2)"
                >
                  Value · JSON
                </SectionLabel>
                <JsonBlock>
                  {"{"}
                  <br />
                  {IND}"orderId": <JStr>"ORD-88213"</JStr>,
                  <br />
                  {IND}"amount": <JNum>129.00</JNum>,
                  <br />
                  {IND}"status": <JStr>"CREATED"</JStr>
                  <br />
                  {"}"}
                </JsonBlock>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Properties</SectionLabel>
                <KV
                  rows={[
                    ["content_type", <span className="mono3" style={MONO11}>application/json</span>],
                    ["delivery_mode", "2 · persistent"],
                    ["expiration", <span className="mono3" style={MONO11}>30000</span>],
                    ["headers", <span className="mono3" style={MONO11}>x-retry=2 · traceId=t-9f21</span>],
                  ]}
                />
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.messages.rabbitmq.xdeath")}
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.copy")}</Button>
              <Button variant="outline">{t("board.messages.rabbitmq.republish")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.ackRemove")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.rabbitmq.footer")}
        </span>
        <span className="flex-1" />
      </Toolbar>
    </Page>
  );
}
