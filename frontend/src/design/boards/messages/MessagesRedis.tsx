import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, SkeletonRows, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/design/ui";
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
  SectionLabel,
  Segmented,
  SelectField,
  Status,
} from "@/components";
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
        <SelectField
          value="orders:events"
          prefix="Stream："
          options={[{ value: "orders:events" }]}
        />
        <Segmented options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Input className="mono3" style={{ flex: "0 0 150px" }} defaultValue="- ～ +" />
        <Input className="mono3" style={{ flex: "0 0 70px" }} defaultValue="100" />
        <Button>{t("board.common.query")}</Button>
      </Toolbar>

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>Entry ID</TableHead>
                <TableHead style={R}>{t("board.messages.redis.fieldCount")}</TableHead>
                <TableHead>{t("board.messages.redis.fieldSummary")}</TableHead>
                <TableHead>{t("board.common.time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                selected={selected === "1756454646018-0"}
                onClick={() => setSelected("1756454646018-0")}
              >
                <TableCell className="mono3" style={MONO11}>1756454646018-0</TableCell>
                <TableCell className="mono3" style={R}>5</TableCell>
                <TableCell className="mono3" style={DIM11}>
                  orderId=ORD-88213 · amount=129.00 · status=CREATED …
                </TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:06.018</TableCell>
              </TableRow>
              <TableRow selected={selected === "1756454646018-1"} onClick={() => setSelected("1756454646018-1")}>
                <TableCell className="mono3" style={MONO11}>1756454646018-1</TableCell>
                <TableCell className="mono3" style={R}>5</TableCell>
                <TableCell className="mono3" style={DIM11}>
                  orderId=ORD-88214 · amount=45.00 · status=CREATED …
                </TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:06.018</TableCell>
              </TableRow>
              <TableRow selected={selected === "1756454647221-0"} onClick={() => setSelected("1756454647221-0")}>
                <TableCell className="mono3" style={MONO11}>1756454647221-0</TableCell>
                <TableCell className="mono3" style={R}>6</TableCell>
                <TableCell className="mono3" style={DIM11}>
                  orderId=ORD-88215 · amount=268.00 · coupon=NEW10 …
                </TableCell>
                <TableCell className="mono3" style={MONO11}>10:24:07.221</TableCell>
              </TableRow>
              <SkeletonRows colSpan={4} widths={["70%", "52%"]} />
            </TableBody>
          </Table>
        </ListPane>

        {selected != null && (
          <DetailPanel width={410} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={selected}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>entry</Status>}
              tabs={SHEET_TABS.map((id) => ({ id, label: t(id) }))}
              activeTab={tab}
              onTabChange={setTab}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>{t("board.messages.redis.fields")}</SectionLabel>
                <Card style={{ overflow: "hidden" }}>
                  <Table className="text-xs">
                    <TableBody>
                      {FIELDS.map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="mono3" style={{ color: "var(--c-muted)", width: "90px" }}>{k}</TableCell>
                          <TableCell className="mono3">{v}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline">{t("board.common.copy")}</Button>
              <Button variant="outline">{t("board.messages.redis.xaddTemplate")}</Button>
              <span className="flex-1" />
              <Button variant="destructive">XDEL</Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>

      <Toolbar style={{ borderTop: "1px solid var(--c-border)", borderBottom: "none" }}>
        <span className="mono3" style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          XRANGE orders:events - + COUNT 100
        </span>
        <span className="flex-1" />
        <Button variant="outline">
          <ChevronLeft size={13} aria-hidden />
          {t("board.messages.redis.older")}
        </Button>
        <Button variant="outline">
          {t("board.messages.redis.newer")}
          <ChevronRight size={13} aria-hidden />
        </Button>
      </Toolbar>
    </Page>
  );
}
