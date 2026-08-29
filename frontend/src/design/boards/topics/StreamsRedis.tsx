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
        actions={<Btn variant="primary">{t("board.topics.redis.newStream")}</Btn>}
      />
      <Toolbar>
        <Field style={{ flex: "0 0 200px" }} placeholder={t("board.topics.redis.searchKey")} />
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "var(--c-mono-dim)" }}>
          <Sw checked={showAll} onCheckedChange={setShowAll} label={t("board.topics.redis.showAllKeys")} />
          {t("board.topics.redis.showAllKeys")}
        </span>
        <span style={{ flex: 1 }} />
        <SelectField value={t("board.topics.redis.sortByXlen")} />
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Stream Key</TH>
                <TH style={{ textAlign: "right" }}>XLEN</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.group")}</TH>
                <TH>last-generated-id</TH>
                <TH style={{ textAlign: "right" }}>{t("board.common.memory")}</TH>
                <TH>maxlen</TH>
              </TR>
            </THead>
            <TBody>
              <TR selected={selected === "orders:events"} onClick={() => setSelected("orders:events")}>
                <TD>
                  <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>orders:events</b>
                </TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1 204 771</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>3</TD>
                <TD className="mono3" style={MONO11}>1756454646018-0</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>86 MB</TD>
                <TD><Status tone="ok">~1M</Status></TD>
              </TR>
              <TR selected={selected === "payments:captured"} onClick={() => setSelected("payments:captured")}>
                <TD className="mono3" style={NAME}>payments:captured</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>640 208</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>2</TD>
                <TD className="mono3" style={MONO11}>1756454641773-2</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>41 MB</TD>
                <TD><Status tone="ok">~500K</Status></TD>
              </TR>
              <TR selected={selected === "iot:raw"} onClick={() => setSelected("iot:raw")}>
                <TD className="mono3" style={NAME}>iot:raw</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>8 402 118</TD>
                <TD className="mono3" style={{ textAlign: "right" }}>1</TD>
                <TD className="mono3" style={MONO11}>1756454647221-4</TD>
                <TD className="mono3" style={{ textAlign: "right", color: "var(--c-warn-text)" }}>612 MB</TD>
                <TD><Status tone="warn">{t("board.topics.redis.unbounded")}</Status></TD>
              </TR>
              <SkeletonRows colSpan={6} widths={["64%", "48%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={390} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>stream</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>XLEN</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 204 771
                  </div>
                </Card>
                <Card style={{ padding: "9px 12px" }}>
                  <div style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{t("board.topics.redis.xaddRate")}</div>
                  <div className="mono3" style={{ fontSize: "15px", fontWeight: 600, marginTop: "2px" }}>
                    1 104/s
                  </div>
                </Card>
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
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.viewMessages")}</Btn>
              <Btn>XTRIM…</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">{t("board.topics.redis.deleteKey")}</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>
    </Page>
  );
}
