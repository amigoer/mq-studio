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

const SHEET_TABS = ["board.common.overview", "board.common.partition", "board.common.subscription", "board.common.policy"] as const;
const NAME = { fontSize: "11.5px" } as const;

/** Board 12a — Pulsar topics, scoped by a tenant / namespace cascade. */
export function TopicsPulsar() {
  const [persistentOnly, setPersistentOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader
        title="Topic"
        subtitle={t("board.topics.pulsar.subtitle")}
        actions={<Button>{t("board.common.newTopic")}</Button>}
      />
      <Toolbar>
        <SelectField value="opt" options={[{ value: "opt", label: t("board.topics.pulsar.tenant") }]} />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.topics.pulsar.namespace") }]} />
        <Input className="w-[180px] flex-none" placeholder={t("board.topics.pulsar.searchTopic")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Switch checked={persistentOnly} onCheckedChange={setPersistentOnly} />
          {t("board.topics.pulsar.persistentOnly")}
        </span>
        <span className="flex-1" />
        <SelectField value="opt" options={[{ value: "opt", label: t("board.common.sortByPending") }]} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.partition")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.topics.pulsar.producers")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.subscription")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.inRate")}</TableHead>
                <TableHead style={{ textAlign: "right" }}>{t("board.common.pending")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow selected={selected === "order-created"} onClick={() => setSelected("order-created")}>
                <TableCell>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                    persistent://ecommerce/orders/order-created
                  </b>
                </TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>8</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>4</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>3</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 104/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>6 591</TableCell>
              </TableRow>
              <TableRow selected={selected === "payment-captured"} onClick={() => setSelected("payment-captured")}>
                <TableCell className="mono3" style={NAME}>persistent://ecommerce/orders/payment-captured</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>4</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>2</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>880/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right" }}>1 830</TableCell>
              </TableRow>
              <TableRow selected={selected === "metrics-tick"} onClick={() => setSelected("metrics-tick")}>
                <TableCell className="mono3" style={{ ...NAME, color: "var(--c-muted)" }}>
                  non-persistent://ecommerce/orders/metrics-tick
                </TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>2 400/s</TableCell>
                <TableCell className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>—</TableCell>
              </TableRow>
              <SkeletonRows colSpan={6} widths={["70%", "52%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={390} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>{t("board.topics.pulsar.eightParts")}</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.pulsar.inOut")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 104 / 2 987
                  </div>
                </Panel>
                <Panel style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.pulsar.storageSize")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    18.2 GB
                  </div>
                </Panel>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.topics.pulsar.policies")}</SectionLabel>
                <KV
                  rows={[
                    [t("board.topics.pulsar.ttl"), t("board.topics.pulsar.sevenDays")],
                    [t("board.topics.pulsar.retention"), t("board.topics.pulsar.retentionValue")],
                    [t("board.topics.pulsar.backlogQuota"), t("board.topics.pulsar.quotaValue")],
                    ["Schema", t("board.topics.pulsar.schema")],
                  ]}
                />
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.common.subscription")}</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="warn">settle-sub · 6 210</Status>
                  <Status tone="ok">notify-sub</Status>
                  <Status tone="ok">audit-sub</Status>
                </div>
              </div>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.viewMessages")}</Button>
              <Button variant="outline">{t("board.topics.pulsar.unload")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">{t("board.common.delete")}</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}
