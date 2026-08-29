import { useState } from "react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  KV,
  SectionLabel,
  SelectField,
  Sheet,
  SheetBody,
  SheetFooter,
  SheetHeader,
  Status,
  Sw,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
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
        actions={<Btn variant="primary">{t("board.common.newTopic")}</Btn>}
      />
      <Toolbar>
        <SelectField value={t("board.topics.pulsar.tenant")} />
        <SelectField value={t("board.topics.pulsar.namespace")} />
        <Field style={{ flex: "0 0 180px" }} placeholder={t("board.topics.pulsar.searchTopic")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={persistentOnly} onCheckedChange={setPersistentOnly} label={t("board.topics.pulsar.persistentOnly")} />
          {t("board.topics.pulsar.persistentOnly")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.common.sortByPending")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Topic</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.partition")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.topics.pulsar.producers")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.subscription")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.inRate")}</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.pending")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "order-created"} onClick={() => setSelected("order-created")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                    persistent://ecommerce/orders/order-created
                  </b>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>8</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 104/s</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>6 591</TD>
              </TR>
              <TR selected={selected === "payment-captured"} onClick={() => setSelected("payment-captured")}>
                <TD className="mono3" style={NAME}>persistent://ecommerce/orders/payment-captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>4</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>880/s</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 830</TD>
              </TR>
              <TR selected={selected === "metrics-tick"} onClick={() => setSelected("metrics-tick")}>
                <TD className="mono3" style={{ ...NAME, color: "var(--c-muted)" }}>
                  non-persistent://ecommerce/orders/metrics-tick
                </TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>1</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>2 400/s</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-muted)" }}>—</TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["70%", "52%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>{t("board.topics.pulsar.eightParts")}</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.pulsar.inOut")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 104 / 2 987
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.pulsar.storageSize")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    18.2 GB
                  </div>
                </Card>
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
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.viewMessages")}</Btn>
              <Btn>{t("board.topics.pulsar.unload")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.common.delete")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
