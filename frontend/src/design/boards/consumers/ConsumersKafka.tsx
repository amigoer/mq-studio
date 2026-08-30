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
  MiniStat,
  Panel,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.consumers.kafka.assignment", "board.common.members", "board.common.offset"] as const;
const R = { textAlign: "right" } as const;

/** Board 14a — Kafka consumer groups; Rebalancing is a first-class state. */
export function ConsumersKafka() {
  const [lagOnly, setLagOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.consumerGroup")} subtitle={t("board.consumers.kafka.subtitle")} />
      <Toolbar>
        <Input className="w-[220px] flex-none" placeholder={t("board.common.searchGroups")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={lagOnly} onCheckedChange={setLagOnly} />
          {t("board.consumers.kafka.lagOnly")}
        </span>
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.consumers.kafka.sortByLag") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>{t("board.common.status")}</TableHead>
                <TableHead style={R}>{t("board.common.members")}</TableHead>
                <TableHead style={R}>Topic</TableHead>
                <TableHead style={R}>{t("board.consumers.kafka.totalLag")}</TableHead>
                <TableHead style={R}>{t("board.common.consumeRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "settle-consumer"} onClick={() => setSelected("settle-consumer")}>
                <TableCell><b style={{ fontWeight: 500 }}>settle-consumer</b></TableCell>
                <TableCell><Status tone="ok">Stable</Status></TableCell>
                <TableCell className="mono3" style={R}>6</TableCell>
                <TableCell className="mono3" style={R}>1</TableCell>
                <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>9 820</TableCell>
                <TableCell className="mono3" style={R}>1 104/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "notify-consumer"} onClick={() => setSelected("notify-consumer")}>
                <TableCell>notify-consumer</TableCell>
                <TableCell><Status tone="ok">Stable</Status></TableCell>
                <TableCell className="mono3" style={R}>4</TableCell>
                <TableCell className="mono3" style={R}>1</TableCell>
                <TableCell className="mono3" style={R}>1 220</TableCell>
                <TableCell className="mono3" style={R}>2 003/s</TableCell>
              </TableRow>
              <TableRow selected={selected === "audit-pipeline"} onClick={() => setSelected("audit-pipeline")}>
                <TableCell>audit-pipeline</TableCell>
                <TableCell><Status tone="warn">Rebalancing</Status></TableCell>
                <TableCell className="mono3" style={R}>3→4</TableCell>
                <TableCell className="mono3" style={R}>2</TableCell>
                <TableCell className="mono3" style={R}>840</TableCell>
                <TableCell className="mono3" style={R}>—</TableCell>
              </TableRow>
              <SkeletonRows colSpan={6} widths={["66%", "50%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="ok" style={{ fontSize: "10px" }}>Stable</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <MiniStat label={t("board.consumers.kafka.totalLag")} value="9 820" color="var(--c-warn-text)" size={15} />
                <MiniStat label={t("board.common.members")} value="6" size={15} />
                <MiniStat label={t("board.consumers.kafka.strategy")} value="range" size={15} />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.consumers.kafka.partitionLag")}</SectionLabel>
                <Panel style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead style={R}>P</TableHead>
                        <TableHead>member</TableHead>
                        <TableHead style={R}>committed</TableHead>
                        <TableHead style={R}>end</TableHead>
                        <TableHead style={R}>lag</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="mono3" style={R}>0</TableCell>
                        <TableCell className="mono3">c-1@10.2.3.4</TableCell>
                        <TableCell className="mono3" style={R}>88 199 021</TableCell>
                        <TableCell className="mono3" style={R}>88 204 771</TableCell>
                        <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>5 750</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="mono3" style={R}>1</TableCell>
                        <TableCell className="mono3">c-1@10.2.3.4</TableCell>
                        <TableCell className="mono3" style={R}>88 201 990</TableCell>
                        <TableCell className="mono3" style={R}>88 204 018</TableCell>
                        <TableCell className="mono3" style={R}>2 028</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="mono3" style={R}>2</TableCell>
                        <TableCell className="mono3">c-2@10.2.3.5</TableCell>
                        <TableCell className="mono3" style={R}>88 202 771</TableCell>
                        <TableCell className="mono3" style={R}>88 204 813</TableCell>
                        <TableCell className="mono3" style={R}>2 042</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Panel>
              </div>

              <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>{t("board.consumers.kafka.lagHint")}</div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.consumers.kafka.resetOffset")}</Button>
              <Button variant="outline">{t("board.consumers.kafka.exportLag")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.deleteGroup")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
