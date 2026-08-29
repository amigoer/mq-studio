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
  KV,
  Panel,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.overview", "board.common.consumerGroup", "board.common.config"] as const;
const NAME = { fontSize: "11.5px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 12b — Redis streams. The list is XINFO STREAM; XTRIM lives in the sheet. */
export function StreamsRedis() {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Stream"
        subtitle={t("board.topics.redis.subtitle")}
        actions={<Button>{t("board.topics.redis.newStream")}</Button>}
      />
      <Toolbar>
        <Input className="w-[200px] flex-none" placeholder={t("board.topics.redis.searchKey")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          {t("board.topics.redis.showAllKeys")}
        </span>
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.topics.redis.sortByXlen") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Stream Key</TableHead>
                <TableHead style={{ textAlign: "right" }}>XLEN</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.group")}</TableHead>
                <TableHead>last-generated-id</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.memory")}</TableHead>
                <TableHead>maxlen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "orders:events"} onClick={() => setSelected("orders:events")}>
                <TableCell>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>orders:events</b>
                </TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 204 771</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={MONO11}>1756454646018-0</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>86 MB</TableCell>
                <TableCell><Status tone="ok">~1M</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "payments:captured"} onClick={() => setSelected("payments:captured")}>
                <TableCell className="mono3" style={NAME}>payments:captured</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>640 208</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={MONO11}>1756454641773-2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>41 MB</TableCell>
                <TableCell><Status tone="ok">~500K</Status></TableCell>
              </TableRow>
              <TableRow selected={selected === "iot:raw"} onClick={() => setSelected("iot:raw")}>
                <TableCell className="mono3" style={NAME}>iot:raw</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>8 402 118</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1</TableCell>
                <TableCell className="mono3" style={MONO11}>1756454647221-4</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>612 MB</TableCell>
                <TableCell><Status tone="warn">{t("board.topics.redis.unbounded")}</Status></TableCell>
              </TableRow>
              <SkeletonRows colSpan={6} widths={["64%", "48%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={390} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>stream</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>XLEN</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 204 771
                  </div>
                </Panel>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.redis.xaddRate")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 104/s
                  </div>
                </Panel>
              </div>

              <KV
                rows={[
                  ["first-entry", <span className="mono3" style={MONO11}>1756368200104-0</span>],
                  ["last-entry", <span className="mono3" style={MONO11}>1756454646018-0</span>],
                  ["radix-tree", <span className="mono3" style={MONO11}>keys 11 842 · nodes 23 118</span>],
                  [t("board.topics.redis.groupPel"), <span className="mono3" style={MONO11}>{t("board.topics.redis.groupPelValue")}</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.common.consumerGroup")}</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="warn">settle-group · PEL 29</Status>
                  <Status tone="ok">notify-group</Status>
                  <Status tone="ok">audit-group</Status>
                </div>
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.viewMessages")}</Button>
              <Button variant="outline">XTRIM…</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.topics.redis.deleteKey")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
