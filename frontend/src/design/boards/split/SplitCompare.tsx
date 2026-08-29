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
  ProtoBadge,
  SelectField,
  Status,
} from "@/components";
import { SkeletonRows, Toolbar } from "@/design/shell";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

const TAG = { fontSize: "10px" } as const;
const R = { textAlign: "right" } as const;

/**
 * Board 5b — two connections pinned side by side. Each pane keeps its own page,
 * filters, scroll and refresh timer; a third would want its own window instead.
 */
export function SplitCompare({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Pane
        badge={<ProtoBadge protocol="rocketmq" label="RMQ 5.x" />}
        name="rocketmq-order"
        page={t("board.common.messageQuery")}
        status={t("board.split.status1")}
        divider
        onClose={onClose}
        toolbar={
          <>
            <SelectField className="text-xs" value="ORDER_CREATE" options={[{ value: "ORDER_CREATE" }]} />
            <Input className="mono3" style={{ flex: 1, fontSize: "11px" }} defaultValue="ORD-88213" />
            <Button style={{ padding: "3.5px 10px" }}>
              {t("board.common.query")}
            </Button>
          </>
        }
      >
        <Table style={{ fontSize: "11px" }}>
          <TableHeader>
            <TableRow>
              <TableHead>MsgId</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>{t("board.common.time")}</TableHead>
              <TableHead>{t("board.common.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="mono3" style={{ fontSize: "10.5px" }}>7F00…4C1</TableCell>
              <TableCell>create</TableCell>
              <TableCell className="mono3" style={{ fontSize: "10.5px" }}>10:24:07</TableCell>
              <TableCell><Status tone="warn" style={TAG}>{t("board.common.retrying")}</Status></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="mono3" style={{ fontSize: "10.5px", color: "var(--c-mono-dim)" }}>7F00…4C2</TableCell>
              <TableCell>paid</TableCell>
              <TableCell className="mono3" style={{ fontSize: "10.5px" }}>10:24:09</TableCell>
              <TableCell><Status tone="ok" style={TAG}>{t("board.common.consumed")}</Status></TableCell>
            </TableRow>
            <SkeletonRows colSpan={4} widths={["76%", "58%"]} />
          </TableBody>
        </Table>
      </Pane>

      <Pane
        badge={<ProtoBadge protocol="kafka" />}
        name="prod-kafka-cn"
        page={t("board.common.consumerGroup")}
        status={t("board.split.status2")}
        onClose={onClose}
        toolbar={
          <>
            <Input style={{ flex: 1, fontSize: "11px" }} placeholder={t("board.common.searchGroups")} />
            <SelectField
              className="text-xs"
              value="lag"
              options={[{ value: "lag", label: t("board.split.byLag") }]}
            />
          </>
        }
      >
        <Table style={{ fontSize: "11px" }}>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead style={R}>Lag</TableHead>
              <TableHead style={R}>{t("board.common.members")}</TableHead>
              <TableHead>{t("board.common.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>settle-consumer</TableCell>
              <TableCell className="mono3" style={{ ...R, color: "var(--c-warn-text)" }}>9 820</TableCell>
              <TableCell className="mono3" style={R}>4</TableCell>
              <TableCell><Status tone="warn" style={TAG}>{t("board.common.backlog")}</Status></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>notify-consumer</TableCell>
              <TableCell className="mono3" style={R}>1 220</TableCell>
              <TableCell className="mono3" style={R}>6</TableCell>
              <TableCell><Status tone="ok" style={TAG}>Stable</Status></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>audit-pipeline</TableCell>
              <TableCell className="mono3" style={R}>840</TableCell>
              <TableCell className="mono3" style={R}>2</TableCell>
              <TableCell><Status tone="off" style={TAG}>Rebalancing</Status></TableCell>
            </TableRow>
            <SkeletonRows colSpan={4} widths={["64%"]} />
          </TableBody>
        </Table>
      </Pane>
    </>
  );
}

function Pane({
  badge,
  name,
  page,
  status,
  toolbar,
  children,
  divider,
  onClose,
}: {
  badge: ReactNode;
  name: string;
  page: string;
  status: string;
  toolbar: ReactNode;
  children: ReactNode;
  divider?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: divider ? "2px solid var(--c-border)" : undefined,
      }}
    >
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 14px",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-panel)",
        }}
      >
        {badge}
        <b style={{ fontSize: "12px" }}>{name}</b>
        <SelectField
          className="h-6 text-xs"
          value="page"
          options={[{ value: "page", label: t("board.split.page", { page }) }]}
        />
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t("board.split.close", { name })}
          onClick={onClose}
          style={{ display: "flex", color: "var(--c-muted-2)", background: "none", border: "none", padding: 0 }}
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <Toolbar style={{ padding: "8px 14px" }}>{toolbar}</Toolbar>

      <div className="mqs-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {children}
      </div>

      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          padding: "6px 14px",
          borderTop: "1px solid var(--c-border)",
          fontSize: "10.5px",
          color: "var(--c-muted)",
        }}
      >
        {/* Each pane keeps its own connection, so each states its own health. */}
        <span className="mqs-dot" style={{ color: "var(--c-ok)" }} aria-hidden />
        {status}
      </div>
    </div>
  );
}
