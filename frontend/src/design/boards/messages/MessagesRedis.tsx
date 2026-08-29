import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  MiniTable,
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
  { value: "latest", label: "board.common.latestN" },
  { value: "range", label: "board.messages.redis.byIdRange" },
  { value: "time", label: "board.common.byTime" },
] as const;

const SHEET_TABS = ["board.common.field", "board.common.consumeState"] as const;
const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const R = { textAlign: "right" } as const;

const FIELDS = [
  ["orderId", "ORD-88213"],
  ["amount", "129.00"],
  ["currency", "CNY"],
  ["status", "CREATED"],
  ["ts", "1756454646"],
] as const;

/** Board 13d — Redis Stream. Entries are field/value pairs, not a JSON body. */
export function MessagesRedis() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("latest");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(SHEET_TABS[0]);

  const { t } = useTranslation();
  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} subtitle="" />
      <Toolbar>
        <SelectField value="Stream：orders:events" />
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Field className="mono3" style={{ flex: "0 0 150px" }} defaultValue="- ～ +" />
        <Field className="mono3" style={{ flex: "0 0 70px" }} defaultValue="100" />
        <Btn variant="primary">{t("board.common.query")}</Btn>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table className="inset">
            <THead>
              <TR>
                <TH>Entry ID</TH>
                <TH style={R}>{t("board.messages.redis.fieldCount")}</TH>
                <TH>{t("board.messages.redis.fieldSummary")}</TH>
                <TH>{t("board.common.time")}</TH>
              </TR>
            </THead>
            <TBody>
              <TR
                selected={selected === "1756454646018-0"}
                onClick={() => setSelected("1756454646018-0")}
              >
                <TD className="mono3" style={MONO11}>1756454646018-0</TD>
                <TD className="mono3" style={R}>5</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88213 · amount=129.00 · status=CREATED …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:06.018</TD>
              </TR>
              <TR selected={selected === "1756454646018-1"} onClick={() => setSelected("1756454646018-1")}>
                <TD className="mono3" style={MONO11}>1756454646018-1</TD>
                <TD className="mono3" style={R}>5</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88214 · amount=45.00 · status=CREATED …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:06.018</TD>
              </TR>
              <TR selected={selected === "1756454647221-0"} onClick={() => setSelected("1756454647221-0")}>
                <TD className="mono3" style={MONO11}>1756454647221-0</TD>
                <TD className="mono3" style={R}>6</TD>
                <TD className="mono3" style={DIM11}>
                  orderId=ORD-88215 · amount=268.00 · coupon=NEW10 …
                </TD>
                <TD className="mono3" style={MONO11}>10:24:07.221</TD>
              </TR>
              <SkeletonRows colSpan={4} widths={["70%", "52%"]} />
            </TBody>
          </Table>
        </ListPane>

        {selected != null && (
          <Sheet width={410} onDismiss={() => setSelected(null)}>
            <SheetHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>entry</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <SheetBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.messages.redis.fields")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <MiniTable>
                    <TBody>
                      {FIELDS.map(([k, v]) => (
                        <TR key={k}>
                          <TD className="mono3" style={{ color: "var(--c-muted)", width: "90px" }}>{k}</TD>
                          <TD className="mono3">{v}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </MiniTable>
                </Card>
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.common.consumeState")}</SectionLabel>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <Status tone="ok">{t("board.messages.redis.acked")}</Status>
                  <Status tone="warn">{t("board.messages.redis.inPel")}</Status>
                  <Status tone="off">{t("board.messages.redis.notRead")}</Status>
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Btn>{t("board.common.copy")}</Btn>
              <Btn>{t("board.messages.redis.xaddTemplate")}</Btn>
              <span style={{ flex: 1 }} />
              <Btn variant="danger">XDEL</Btn>
            </SheetFooter>
          </Sheet>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          XRANGE orders:events - + COUNT 100
        </span>
        <span style={{ flex: 1 }} />
        <Btn>
          <ChevronLeft size={13} aria-hidden />
          {t("board.messages.redis.older")}
        </Btn>
        <Btn>
          {t("board.messages.redis.newer")}
          <ChevronRight size={13} aria-hidden />
        </Btn>
      </Toolbar>
    </Page>
  );
}
