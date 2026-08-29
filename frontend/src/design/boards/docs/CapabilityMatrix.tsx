import { Page, PageBody, PageHeader } from "@/design/shell";
import { ProtoBadge, Table, TBody, TD, TH, THead, TR } from "@/design/ui";
import { PROTOCOL_ORDER } from "@/design/data/protocols";
import { cn } from "@/lib/utils";

/** `●` supported, `◐` partial or needs configuration, `—` not applicable. */
type Cell = string;

const ROWS: readonly (readonly [string, ...Cell[]])[] = [
  ["总览指标", "●", "●", "●", "●", "●", "◐ $SYS"],
  ["Topic / 队列管理", "●", "●", "● 队列+交换机", "● 含命名空间", "● Stream", "◐ 主题树只读"],
  ["消息查询", "● Key/Id/时间", "● 位点/时间", "◐ 仅浏览队头", "● 游标", "● XRANGE", "◐ 仅实时订阅"],
  ["消费轨迹", "●", "—", "—", "—", "—", "—"],
  ["发送消息", "●", "●", "●", "●", "●", "●"],
  ["消费者组 / 订阅", "● 消费组", "● 消费组", "◐ 连接/信道", "● 订阅", "● 消费组", "● 会话"],
  ["死信 / 重试", "●", "◐ 需 DLT 约定", "● DLX", "●", "◐ PEL/claim", "—"],
  ["重置位点", "●", "●", "—", "● seek", "● XSETID", "—"],
  ["节点运维", "● Broker/NS", "● Broker/Ctrl", "● 节点", "◐ Broker+Bookie", "◐ INFO", "◐ $SYS 只读"],
  ["ACL / 用户", "●", "●", "◐ 用户/vhost", "◐ Token 只读", "—", "—"],
  ["延迟 / 定时消息", "●", "—", "◐ 插件", "●", "—", "—"],
];

/** `.cd` tone follows the leading glyph. */
function toneOf(cell: string): "y" | "p" | "n" {
  if (cell.startsWith("●")) return "y";
  if (cell.startsWith("◐")) return "p";
  return "n";
}

/** Board 3h — which module each protocol can actually support. */
export function CapabilityMatrix() {
  return (
    <Page>
      <PageHeader
        title="协议能力矩阵"
        subtitle="每个模块对每种协议的可用性（● 支持 / ◐ 部分或需配置 / — 不适用，页面按此显隐）"
      />
      <PageBody>
        <div style={{ maxWidth: "860px", width: "100%", margin: "0 auto" }}>
          <Table style={{ fontSize: "11.5px" }}>
            <THead>
              <TR>
                <TH>模块</TH>
                {PROTOCOL_ORDER.map((p) => (
                  <TH key={p} style={{ textAlign: "center" }}>
                    <ProtoBadge protocol={p} />
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {ROWS.map(([label, ...cells]) => (
                <TR key={label}>
                  <TD>{label}</TD>
                  {cells.map((cell, i) => (
                    <TD key={i} className={cn("cd", toneOf(cell))}>
                      {cell}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </PageBody>
    </Page>
  );
}
