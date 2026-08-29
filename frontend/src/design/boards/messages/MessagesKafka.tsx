import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
} from "@/design/ui";
import { useTranslation } from "react-i18next";

const MODES = [
  { value: "latest", label: "board.common.latestN" },
  { value: "offset", label: "board.messages.kafka.byOffset" },
  { value: "time", label: "board.common.byTime" },
  { value: "key", label: "board.common.byKey" },
] as const;

const SHEET_TABS = ["board.common.message", "board.term.headers"] as const;
const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/** Board 13a — Kafka messages: partition + offset / timestamp / key, no trace. */
export function MessagesKafka() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("latest");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} subtitle="" />
      <Toolbar>
        <SelectField value="Topic：orders.created" />
        <SelectField value={t("board.messages.kafka.allPartitions")} />
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 90px" }} defaultValue="500" />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH style={R}>{t("board.common.partition")}</TH>
                <TH style={R}>Offset</TH>
                <TH>Key</TH>
                <TH>{t("board.messages.kafka.valueSummary")}</TH>
                <TH style={R}>Headers</TH>
                <TH>{t("board.common.timestamp")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "88 204 771"} onClick={() => setSelected("88 204 771")}>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={R}>88 204 771</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88213","amount":129…'}
                </TD>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <TR selected={selected === "88 204 772"} onClick={() => setSelected("88 204 772")}>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={R}>88 204 772</TD>
                <TD className="mono3" style={MONO11}>ORD-88214</TD>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88214","amount":45…'}
                </TD>
                <TD className="mono3" style={R}>3</TD>
                <TD className="mono3" style={MONO11}>10:24:07.310</TD>
              </TR>
              <TR selected={selected === "88 204 773"} onClick={() => setSelected("88 204 773")}>
                <TD className="mono3" style={R}>0</TD>
                <TD className="mono3" style={R}>88 204 773</TD>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>null</TD>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88215","amount":268…'}
                </TD>
                <TD className="mono3" style={R}>1</TD>
                <TD className="mono3" style={MONO11}>10:24:08.004</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["74%", "58%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={`offset ${selected}`}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>p3</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <KV
                rows={[
                  [t("board.messages.kafka.partitionOffset"), <span className="mono3" style={MONO11}>3 / 88 204 771</span>],
                  ["Key", <span className="mono3" style={MONO11}>ORD-88213（String）</span>],
                  [t("board.common.timestamp"), <span className="mono3" style={MONO11}>10:24:07.221 · CreateTime</span>],
                  [t("board.common.size"), <span className="mono3" style={MONO11}>1.2 KB · lz4</span>],
                ]}
              />

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
                <SectionLabel style={{ marginBottom: "6px" }}>Headers（3）</SectionLabel>
                <KV
                  rows={[
                    ["traceId", <span className="mono3" style={MONO11}>t-9f21</span>],
                    ["source", <span className="mono3" style={MONO11}>order-svc</span>],
                    ["schemaId", <span className="mono3" style={MONO11}>42</span>],
                  ]}
                />
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.messages.kafka.noTrace")}
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.copy")}</Btn>
              <Btn>{t("board.messages.kafka.resendTo")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn>{t("board.common.export")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.kafka.cursor")}
        </span>
        <span style={{ flex: 1 }} />
        <Btn>
          {t("board.messages.kafka.loadOlder")}
          <ChevronLeft size={13} aria-hidden />
        </Btn>
        <Btn>
          <ChevronRight size={13} aria-hidden />
          {t("board.messages.kafka.loadNewer")}
        </Btn>
      </Toolbar>
    </Page>
  );
}
