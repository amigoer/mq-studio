import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
  { value: "peek", label: "board.messages.pulsar.peek" },
  { value: "msgid", label: "board.messages.pulsar.byMsgId" },
  { value: "time", label: "board.messages.pulsar.byPublishTime" },
] as const;

const SHEET_TABS = ["board.common.message", "board.common.properties"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const R = { textAlign: "right" } as const;

/** Board 13c — Pulsar. Peeking by subscription never moves the cursor. */
export function MessagesPulsar() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("peek");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} subtitle="" />
      <Toolbar>
        <SelectField value="Topic：…/order-created" />
        <SelectField value={t("board.messages.pulsar.subscription")} />
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue="50" />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>MessageId</TH>
                <TH>Key</TH>
                <TH>{t("board.common.summary")}</TH>
                <TH style={R}>{t("board.common.properties")}</TH>
                <TH>{t("board.messages.pulsar.publishTime")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "812:4:0"} onClick={() => setSelected("812:4:0")}>
                <TD className="mono3" style={MONO11}>812:4:0</TD>
                <TD className="mono3" style={MONO11}>ORD-88213</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <TR selected={selected === "812:5:0"} onClick={() => setSelected("812:5:0")}>
                <TD className="mono3" style={MONO11}>812:5:0</TD>
                <TD className="mono3" style={MONO11}>ORD-88214</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TD>
                <TD className="mono3" style={R}>4</TD>
                <TD className="mono3" style={MONO11}>10:24:07.310</TD>
              </TR>
              <TR selected={selected === "812:6:1"} onClick={() => setSelected("812:6:1")}>
                <TD className="mono3" style={MONO11}>812:6:1</TD>
                <TD className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>—</TD>
                <TD className="mono3" style={DIM11}>{'{"orderId":"ORD-88215"…'}</TD>
                <TD className="mono3" style={R}>2</TD>
                <TD className="mono3" style={MONO11}>10:24:08.004</TD>
              </TR>
              <SkeletonRows colSpan={5} widths={["66%", "50%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>ledger:entry</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <KV
                rows={[
                  ["MessageId", <span className="mono3" style={MONO11}>ledger 812 · entry 4 · batch 0</span>],
                  ["Producer", <span className="mono3" style={MONO11}>order-svc-producer-2</span>],
                  [t("board.messages.pulsar.publishEventTime"), <span className="mono3" style={MONO11}>10:24:07.221 / 10:24:07.001</span>],
                  ["Schema", <span className="mono3" style={MONO11}>JSON v3</span>],
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
                <SectionLabel style={{ marginBottom: "6px" }}>Properties（4）</SectionLabel>
                <KV
                  rows={[
                    ["traceId", <span className="mono3" style={MONO11}>t-9f21</span>],
                    ["env", <span className="mono3" style={MONO11}>prod</span>],
                  ]}
                />
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.copy")}</Btn>
              <Btn>{t("board.messages.pulsar.seekHere")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn>{t("board.common.export")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.pulsar.peekNote")}
        </span>
        <span style={{ flex: 1 }} />
      </Toolbar>
    </Page>
  );
}
