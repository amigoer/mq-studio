import { useState } from "react";
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
  KV,
  MiniStat,
  Panel,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.consumers.pulsar.cursor", "board.term.consumer", "board.common.config"] as const;
const R = { textAlign: "right" } as const;
const NAME = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** Board 14b — Pulsar subscriptions. Cursors move by seek, not by offset reset. */
export function SubscriptionsPulsar() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.subscription")} subtitle={t("board.consumers.pulsar.subtitle")} />
      <Toolbar>
        <SelectField value="opt" options={[{ value: "opt", label: t("board.consumers.pulsar.allTopics") }]} />
        <Input className="w-[200px] flex-none" placeholder={t("board.consumers.pulsar.search")} />
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.common.sortByPending") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.common.subscription")}</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>{t("board.common.type")}</TableHead>
                <TableHead style={R}>{t("board.common.pending")}</TableHead>
                <TableHead style={R}>{t("board.common.unacked")}</TableHead>
                <TableHead style={R}>{t("board.common.outRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "settle-sub"} onClick={() => setSelected("settle-sub")}>
                <TableCell><b style={{ fontWeight: 500 }}>settle-sub</b></TableCell>
                <TableCell className="mono3" style={NAME}>…/order-created</TableCell>
                <TableCell>Shared</TableCell>
                <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>6 210</TableCell>
                <TableCell className="mono3" style={R}>48</TableCell>
                <TableCell className="mono3" style={R}>1 104/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "notify-sub"} onClick={() => setSelected("notify-sub")}>
                <TableCell>notify-sub</TableCell>
                <TableCell className="mono3" style={NAME}>…/order-created</TableCell>
                <TableCell>Key_Shared</TableCell>
                <TableCell className="mono3" style={R}>381</TableCell>
                <TableCell className="mono3" style={R}>6</TableCell>
                <TableCell className="mono3" style={R}>2 003/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "audit-sub"} onClick={() => setSelected("audit-sub")}>
                <TableCell>audit-sub</TableCell>
                <TableCell className="mono3" style={NAME}>…/payment-captured</TableCell>
                <TableCell>Failover</TableCell>
                <TableCell className="mono3" style={R}>1 830</TableCell>
                <TableCell className="mono3" style={R}>0</TableCell>
                <TableCell className="mono3" style={R}>880/s</TableCell>
              </TableRow>
              <SkeletonRows colSpan={6} widths={["62%", "46%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>Shared</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <MiniStat label={t("board.common.pending")} value="6 210" color="var(--c-warn-text)" size={15} />
                <MiniStat label={t("board.common.unacked")} value="48" size={15} />
              </div>

              <KV
                rows={[
                  ["markDelete", <span className="mono3" style={MONO11}>812:2:0</span>],
                  ["readPosition", <span className="mono3" style={MONO11}>812:6:1</span>],
                  [t("board.consumers.pulsar.oldestUnacked"), <span className="mono3" style={MONO11}>{t("board.consumers.pulsar.oldestValue")}</span>],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Consumer（4）</SectionLabel>
                <Panel style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>name</TableHead>
                        <TableHead>addr</TableHead>
                        <TableHead style={R}>{t("board.common.unacked")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="mono3">settle-1</TableCell>
                        <TableCell className="mono3">10.2.3.4</TableCell>
                        <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>41</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="mono3">settle-2</TableCell>
                        <TableCell className="mono3">10.2.3.5</TableCell>
                        <TableCell className="mono3" style={R}>7</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Panel>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <Button variant="outline">{t("board.consumers.pulsar.seekTime")}</Button>
                <Button variant="outline">Seek MessageId…</Button>
                <Button variant="outline">{t("board.consumers.pulsar.skipN")}</Button>
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="destructive">{t("board.consumers.pulsar.clearBacklog")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.consumers.pulsar.unsubscribe")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
