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
  Panel,
  ProtoBadge,
  SelectField,
  Status,
} from "@/components";
import { useTranslation } from "react-i18next";

const SHEET_TABS = ["board.common.overview", "board.common.partition", "board.common.consumers", "board.common.config"] as const;

/** Board 4c — Kafka topics. Same skeleton as 3c; queues become partitions. */
export function TopicsKafka() {
  const [showInternal, setShowInternal] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[1]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.kafka.subtitle")}
        actions={<Button>{t("board.common.newTopic")}</Button>}
      />
      <Toolbar>
        <Input className="w-[240px] flex-none" placeholder={t("board.common.searchTopic")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={showInternal} onCheckedChange={setShowInternal} />
          {t("board.topics.kafka.showInternal")}
        </span>
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.common.sortByBacklog") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.partition")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.topics.kafka.replicas")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.topics.kafka.produceRate")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.backlog")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "orders.created"} onClick={() => setSelected("orders.created")}>
                <TableCell>
                  <b style={{ fontWeight: 500 }}>orders.created</b>{" "}
                  <Status tone="warn" style={{ fontSize: "10px" }}>URP</Status>
                </TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>24</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 104/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>9 820</TableCell>
              </TableRow>
              <TableRow selected={selected === "payments.captured"} onClick={() => setSelected("payments.captured")}>
                <TableCell>payments.captured</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>12</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>840</TableCell>
              </TableRow>
              <TableRow selected={selected === "user.signup"} onClick={() => setSelected("user.signup")}>
                <TableCell>user.signup</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>6</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>45/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
              </TableRow>
              <SkeletonRows colSpan={5} widths={["76%", "58%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<ProtoBadge protocol="kafka" />}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody style={{ gap: "10px" }}>
              <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: "var(--c-muted)" }}>
                <span>{t("board.topics.kafka.partitionInfo")}</span>
                <span className="flex-1" />
                <span style={{ color: "var(--c-warn-text)" }}>{t("board.topics.kafka.urpWarn")}</span>
              </div>
              <Panel style={{ overflow: "hidden" }}>
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead style={{ textAlign: "right" }}>P</TableHead>
                      <TableHead style={{ textAlign: "right" }}>Leader</TableHead>
                      <TableHead>ISR</TableHead>
                      <TableHead style={{ textAlign: "right" }}>{t("board.topics.kafka.endOffset")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>0</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>1</TableCell>
                      <TableCell className="mono3">1,2,3</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>88 204 771</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>1</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                      <TableCell className="mono3">2,3,1</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>88 198 042</TableCell>
                    </TableRow>
                    <TableRow style={{ background: "var(--c-warn-bg-soft)" }}>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                      <TableCell className="mono3" style={{ color: "var(--c-warn-text)" }}>
                        3,1 <span style={{ fontSize: "9.5px" }}>{t("board.topics.kafka.missing2")}</span>
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>88 201 118</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>1</TableCell>
                      <TableCell className="mono3">1,3,2</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>88 197 664</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} style={{ padding: "6px 10px", color: "var(--c-muted)", fontSize: "10.5px" }}>
                        {t("board.topics.kafka.morePartitions")}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Panel>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.viewMessages")}</Button>
              <Button variant="outline">{t("board.topics.kafka.addPartitions")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.delete")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
