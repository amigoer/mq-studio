import { useState } from "react";
import { ChevronDown } from "lucide-react";
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
} from "@/components";
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
        <SelectField
          value="…/order-created"
          prefix="Topic："
          options={[{ value: "…/order-created" }]}
        />
        <SelectField
          value="sub"
          options={[{ value: "sub", label: t("board.messages.pulsar.subscription") }]}
        />
        <Segmented options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Input className="mono3" style={{ flex: "0 0 70px" }} defaultValue="50" />
        <Button>{t("board.common.query")}</Button>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>MessageId</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>{t("board.common.summary")}</TableHead>
                <TableHead style={R}>{t("board.common.properties")}</TableHead>
                <TableHead>{t("board.messages.pulsar.publishTime")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "812:4:0"} onClick={() => setSelected("812:4:0")}>
                <TableCell className="mono3" style={MONO11}>812:4:0</TableCell>
                <TableCell className="mono3" style={MONO11}>ORD-88213</TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88213"…'}</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:07.221</TableCell>
              </TableRow>
              <TableRow selected={selected === "812:5:0"} onClick={() => setSelected("812:5:0")}>
                <TableCell className="mono3" style={MONO11}>812:5:0</TableCell>
                <TableCell className="mono3" style={MONO11}>ORD-88214</TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88214"…'}</TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:07.310</TableCell>
              </TableRow>
              <TableRow selected={selected === "812:6:1"} onClick={() => setSelected("812:6:1")}>
                <TableCell className="mono3" style={MONO11}>812:6:1</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>—</TableCell>
                <TableCell className="mono3" style={DIM11}>{'{"orderId":"ORD-88215"…'}</TableCell>
                <TableCell className="mono3" style={R}>2</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:08.004</TableCell>
              </TableRow>
              <SkeletonRows colSpan={5} widths={["66%", "50%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>ledger:entry</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
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
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.copy")}</Button>
              <Button variant="outline">{t("board.messages.pulsar.seekHere")}</Button>
              <span className="flex-1" />
              <Button variant="outline">{t("board.common.export")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.pulsar.peekNote")}
        </span>
        <span className="flex-1" />
      </Toolbar>
    </Page>
  );
}
