import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
        <SelectField
          value="orders.created"
          prefix="Topic："
          options={[{ value: "orders.created" }]}
        />
        <SelectField
          value="all"
          options={[{ value: "all", label: t("board.messages.kafka.allPartitions") }]}
        />
        <Segmented options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Input className="mono3" style={{ flex: "0 0 90px" }} defaultValue="500" />
        <Button>{t("board.common.query")}</Button>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead style={R}>{t("board.common.partition")}</TableHead>
                <TableHead style={R}>Offset</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>{t("board.messages.kafka.valueSummary")}</TableHead>
                <TableHead style={R}>Headers</TableHead>
                <TableHead>{t("board.common.timestamp")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "88 204 771"} onClick={() => setSelected("88 204 771")}>
                <TableCell className="mono3" style={R}>3</TableCell>
                <TableCell className="mono3" style={R}>88 204 771</TableCell>
                <TableCell className="mono3" style={MONO11}>ORD-88213</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88213","amount":129…'}
                </TableCell>
                <TableCell className="mono3" style={R}>3</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:07.221</TableCell>
              </TableRow>
              <TableRow selected={selected === "88 204 772"} onClick={() => setSelected("88 204 772")}>
                <TableCell className="mono3" style={R}>1</TableCell>
                <TableCell className="mono3" style={R}>88 204 772</TableCell>
                <TableCell className="mono3" style={MONO11}>ORD-88214</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88214","amount":45…'}
                </TableCell>
                <TableCell className="mono3" style={R}>3</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:07.310</TableCell>
              </TableRow>
              <TableRow selected={selected === "88 204 773"} onClick={() => setSelected("88 204 773")}>
                <TableCell className="mono3" style={R}>0</TableCell>
                <TableCell className="mono3" style={R}>88 204 773</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>null</TableCell>
                <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                  {'{"orderId":"ORD-88215","amount":268…'}
                </TableCell>
                <TableCell className="mono3" style={R}>1</TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:08.004</TableCell>
              </TableRow>
              <SkeletonRows colSpan={6} widths={["74%", "58%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={`offset ${selected}`}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>p3</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
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
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.copy")}</Button>
              <Button variant="outline">{t("board.messages.kafka.resendTo")}</Button>
              <span className="flex-1" />
              <Button variant="outline">{t("board.common.export")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.kafka.cursor")}
        </span>
        <span className="flex-1" />
        <Button variant="outline">
          {t("board.messages.kafka.loadOlder")}
          <ChevronLeft size={13} aria-hidden />
        </Button>
        <Button variant="outline">
          <ChevronRight size={13} aria-hidden />
          {t("board.messages.kafka.loadNewer")}
        </Button>
      </Toolbar>
    </Page>
  );
}
