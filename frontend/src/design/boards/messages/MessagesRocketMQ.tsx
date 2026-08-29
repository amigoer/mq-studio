import { useState } from "react";
import { ArrowRight, Copy, X } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  IND,
  JDim,
  JNum,
  JsonBlock,
  JStr,
  KV,
  ProtoBadge,
  SectionLabel,
  Seg,
  SelectField,
  Sheet,
  SheetBody,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Timeline,
  TR,
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const MODES = [
  { value: "key", label: "board.common.byKey" },
  { value: "msgid", label: "board.messages.rocketmq.byMsgId" },
  { value: "time", label: "board.common.byTime" },
] as const;

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/** Board 3d — RocketMQ message search. The consumption trace is RocketMQ-only. */
export function MessagesRocketMQ() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("key");
  const [selected, setSelected] = useState<string | null>(null);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} />
      <Toolbar>
        <SelectField value="Topic：ORDER_CREATE" />
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 180px" }} defaultValue="ORD-88213" />
        <SelectField value={t("board.messages.rocketmq.last6h")} />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>MsgId</TH>
                <TH>Key</TH>
                <TH>Tag</TH>
                <TH style={R}>{t("board.common.queue")}</TH>
                <TH>{t("board.messages.rocketmq.storedAt")}</TH>
                <TH>{t("board.common.status")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR
                selected={selected === "7F0000012A9C…4C1"}
                onClick={() => setSelected("7F0000012A9C…4C1")}
              >
                <TD className="mono3" style={MONO11}>7F0000012A9C…4C1</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD>create</TD>
                <TD className="mono3" style={R}>a/q3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
                <TD><Status tone="warn">{t("board.common.retrying")}</Status></TD>
              </TR>
              <TR selected={selected === "7F0000012A9C…4C2"} onClick={() => setSelected("7F0000012A9C…4C2")}>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>7F0000012A9C…4C2</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD>paid</TD>
                <TD className="mono3" style={R}>a/q1</TD>
                <TD className="mono3" style={MONO11}>10:24:09.310</TD>
                <TD><Status tone="ok">{t("board.common.consumed")}</Status></TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["76%", "62%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={440} onDismiss={() => setSelected(null)}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px",
                borderBottom: "1px solid var(--c-border)",
                background: "var(--c-bg)",
              }}
            >
              <b style={{ fontSize: "13px" }}>{t("board.common.messageDetail")}</b>
              <ProtoBadge protocol="rocketmq" label="RMQ 5.x" />
              <span style={{ flex: 1 }} />
              <Btn>{t("board.common.resend")}</Btn>
              <Btn>{t("board.common.export")}</Btn>
              <button
                type="button"
                aria-label={t("board.common.close")}
                onClick={() => setSelected(null)}
                style={{ display: "flex", color: "var(--c-muted-2)", marginLeft: "2px", background: "none", border: "none", padding: 0 }}
              >
                <X size={15} aria-hidden />
              </button>
            </div>

            <SheetBody>
              <KV
                rows={[
                  [
                    "MsgId",
                    <span
                      className="mono3"
                      style={{ ...MONO11, display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      7F0000012A9C81E44C1
                      <Copy size={12} style={{ color: "var(--c-ok)", flex: "none" }} aria-hidden />
                    </span>,
                  ],
                  ["Key / Tag", <span className="mono3" style={MONO11}>ORD-88213 · create</span>],
                  [t("board.messages.rocketmq.location"), <span className="mono3" style={MONO11}>broker-a / q3 / offset 1 204 771</span>],
                  ["Born", <span className="mono3" style={MONO11}>10.12.3.101 · producer-cli-77</span>],
                  [t("board.messages.rocketmq.sizeRetry"), <span className="mono3" style={MONO11}>1.2 KB · reconsume ×2</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }} action={t("board.messages.rocketmq.formatCopy")}>
                  {t("board.messages.rocketmq.body")}
                </SectionLabel>
                <JsonBlock>
                  {"{"}
                  <br />
                  {IND}"orderId": <JStr>"ORD-88213"</JStr>,
                  <br />
                  {IND}"amount": <JNum>129.00</JNum>,
                  <br />
                  {IND}"currency": <JStr>"CNY"</JStr>,
                  <br />
                  {IND}"items": [ <JDim>{t("board.messages.rocketmq.threeMore")}</JDim> ]
                  <br />
                  {"}"}
                </JsonBlock>
              </div>

              <div style={{ flex: 1, minHeight: 0 }}>
                <SectionLabel style={{ marginBottom: "8px" }}>{t("board.common.trace")}</SectionLabel>
                <Timeline
                  steps={[
                    { title: t("board.messages.rocketmq.produced"), meta: "10:24:07.221 · 10.12.3.101" },
                    { title: t("board.messages.rocketmq.stored"), meta: "broker-a q3 · 0.6ms", color: "var(--c-muted-2)" },
                    { title: t("board.messages.rocketmq.notifyOk"), meta: "10:24:07.902 · 681ms" },
                    {
                      title: t("board.messages.rocketmq.settleRetry"),
                      meta: t("board.messages.rocketmq.nextDelivery"),
                      color: "var(--c-warn)",
                      extra: (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--c-ok)" }}>
                          {t("board.messages.rocketmq.viewRetryQueue")}
                          <ArrowRight size={12} aria-hidden />
                        </span>
                      ),
                    },
                  ]}
                />
              </div>
            </SheetBody>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
