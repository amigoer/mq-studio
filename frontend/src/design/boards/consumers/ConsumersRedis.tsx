import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BulkBar, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import {
  Btn,
  Check,
  SectionLabel,
  SelectField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

type PelEntry = {
  id: string;
  consumer: string;
  idle: string;
  idleColor?: string;
  deliveries: string;
  deliveryColor?: string;
};

const PEL: readonly PelEntry[] = [
  { id: "1756447200104-0", consumer: "settle-1", idle: "2.1h", idleColor: "var(--c-err-text)", deliveries: "17", deliveryColor: "var(--c-warn-text)" },
  { id: "1756450301882-3", consumer: "settle-1", idle: "1.2h", deliveries: "9" },
  { id: "1756453988012-1", consumer: "settle-2", idle: "11m", deliveries: "2" },
];

/**
 * Board 14c — Redis consumer groups. Below the group table sits the selected
 * group's PEL, because claiming and acking is the whole job here.
 */
export function ConsumersRedis() {
  const [selectedGroup, setSelectedGroup] = useState("settle-group");
  const [checked, setChecked] = useState<string[]>(PEL.slice(0, 1).map((e) => e.id));

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allChecked = checked.length === PEL.length;

  return (
    <Page>
      <PageHeader title="消费者组" subtitle="orders:events · 3 组 · PEL 37" />
      <Toolbar>
        <SelectField value="Stream：orders:events" />
        <span style={{ flex: 1 }} />
        <Btn>XAUTOCLAIM idle&gt;60s…</Btn>
      </Toolbar>

      <div style={{ flex: "none", overflow: "hidden" }}>
        <Table className="inset">
          <THead>
            <TR>
              <TH>组</TH>
              <TH style={R}>consumers</TH>
              <TH style={R}>pending</TH>
              <TH>last-delivered-id</TH>
              <TH style={R}>entries-read</TH>
              <TH style={R}>滞后</TH>
            </TR>
          </THead>
          <TBody>
            <TR selected={selectedGroup === "settle-group"} onClick={() => setSelectedGroup("settle-group")}>
              <TD><b style={{ fontWeight: 500 }}>settle-group</b></TD>
              <TD className="mono3" style={R}>2</TD>
              <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>29</TD>
              <TD className="mono3" style={MONO11}>1756454641773-2</TD>
              <TD className="mono3" style={R}>1 204 742</TD>
              <TD className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>982</TD>
            </TR>
            <TR selected={selectedGroup === "notify-group"} onClick={() => setSelectedGroup("notify-group")}>
              <TD>notify-group</TD>
              <TD className="mono3" style={R}>3</TD>
              <TD className="mono3" style={R}>6</TD>
              <TD className="mono3" style={MONO11}>1756454646018-0</TD>
              <TD className="mono3" style={R}>1 204 771</TD>
              <TD className="mono3" style={R}>0</TD>
            </TR>
            <TR selected={selectedGroup === "audit-group"} onClick={() => setSelectedGroup("audit-group")}>
              <TD>audit-group</TD>
              <TD className="mono3" style={R}>1</TD>
              <TD className="mono3" style={R}>2</TD>
              <TD className="mono3" style={MONO11}>1756454640031-5</TD>
              <TD className="mono3" style={R}>1 204 512</TD>
              <TD className="mono3" style={R}>259</TD>
            </TR>
          </TBody>
        </Table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 20px 6px" }}>
        <SectionLabel>{selectedGroup} 的 PEL（29）</SectionLabel>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>勾选后可批量操作</span>
      </div>

      <ListPane>
        <Table className="inset">
          <THead>
            <TR>
              <TH style={{ width: "26px" }}>
                <Check
                  checked={allChecked}
                  label="全选"
                  onChange={() => setChecked(allChecked ? [] : PEL.map((p) => p.id))}
                />
              </TH>
              <TH>Entry ID</TH>
              <TH>consumer</TH>
              <TH style={R}>idle</TH>
              <TH style={R}>投递次数</TH>
            </TR>
          </THead>
          <TBody>
            {PEL.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Check
                    checked={checked.includes(e.id)}
                    label={e.id}
                    onChange={() => toggle(e.id)}
                  />
                </TD>
                <TD className="mono3" style={MONO11}>{e.id}</TD>
                <TD className="mono3" style={MONO11}>{e.consumer}</TD>
                <TD className="mono3" style={{ ...R, color: e.idleColor }}>{e.idle}</TD>
                <TD className="mono3" style={{ ...R, color: e.deliveryColor }}>{e.deliveries}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ListPane>

      <BulkBar hint="idle 超 2h 的条目建议认领或确认">
        <span>已选 {checked.length} 条</span>
        <Btn variant="primary">
              XCLAIM 认领给
              <ChevronDown size={12} aria-hidden />
            </Btn>
        <Btn>XACK 确认</Btn>
      </BulkBar>

    </Page>
  );
}
