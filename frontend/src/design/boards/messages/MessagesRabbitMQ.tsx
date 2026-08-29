import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  IND,
  JNum,
  JsonBlock,
  JStr,
  KV,
  SectionLabel,
  Seg,
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
  WarnBanner,
} from "@/design/ui";
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
        <SelectField value={t("board.messages.rabbitmq.queue")} />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue={t("board.messages.rabbitmq.ten")} />
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <span style={{ flex: 1 }} />
        <Btn variant="primary">{t("board.messages.rabbitmq.fetch")}</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH style={R}>#</TH>
                <TH>routing key</TH>
                <TH>exchange</TH>
                <TH>{t("board.common.properties")}</TH>
                <TH>{t("board.messages.rabbitmq.payloadSummary")}</TH>
                <TH>{t("board.common.redeliver")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "1"} onClick={() => setSelected("1")}>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={MONO11}>order.created</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>persistent</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TD>
                <TD><Status tone="warn" style={TAG}>redelivered</Status></TD>
              </TR>
              <TR selected={selected === "2"} onClick={() => setSelected("2")}>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={MONO11}>order.created</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>persistent</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TD>
                <TD />
              </TR>
              <TR selected={selected === "3"} onClick={() => setSelected("3")}>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>order.updated</TD>
                <TD className="mono3" style={DIM11}>ex.order</TD>
                <TD><Status tone="off" style={TAG}>TTL 30s</Status></TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88101"…'}</TD>
                <TD />
              </TR>
              <SkeletonRows colSpan={6} widths={["60%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={`#${selected} · order.created`}
              badge={<Status tone="warn" style={TAG}>redelivered</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
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
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.copy")}</Btn>
              <Btn>{t("board.messages.rabbitmq.republish")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.ackRemove")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.rabbitmq.footer")}
        </span>
        <span style={{ flex: 1 }} />
      </Toolbar>
    </Page>
  );
}
