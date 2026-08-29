import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ellipsis, Star } from "lucide-react";
import { Page, PageHeader, Toolbar, StatusBar } from "@/design/shell";
import {
  Btn,
  EnvTag,
  Field,
  Menu,
  MenuItem,
  MenuSeparator,
  SelectField,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/design/ui";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import type { Connection } from "@/design/data/connections";
import { PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";

/**
 * Board 8a — the global connection list. Row actions appear on hover; the
 * menu carries the low-frequency operations so the row stays scannable.
 */
export function ConnectionsList({
  connections,
  onNewConnection,
  onOpenTab,
  onDelete,
  onSetDefault,
  onImport,
  onExport,
}: {
  connections: readonly Connection[];
  onNewConnection?: () => void;
  onOpenTab?: (key: string) => void;
  onDelete?: (connection: Connection) => void;
  onSetDefault?: (connection: Connection) => void;
  onImport?: () => void;
  onExport?: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ProtocolId | "all">("all");
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const rows = connections.filter(
    (c) =>
      (filter === "all" || c.protocol === filter) &&
      (query === "" || c.name.toLowerCase().includes(query.toLowerCase())),
  );

  const online = connections.filter((c) => c.status === "online").length;
  const failed = connections.filter((c) => c.status === "failed").length;

  return (
    <Page>
      <PageHeader
        title={t("page.connections.title")}
        subtitle={t("page.connections.subtitle")}
        actions={
          <>
            <Btn onClick={onImport}>{t("page.connections.import")}</Btn>
            <Btn onClick={onExport}>{t("page.connections.export")}</Btn>
            <Btn variant="primary" onClick={onNewConnection}>
              {t("page.connections.new")}
            </Btn>
          </>
        }
      />

      <Toolbar>
        <Field
          style={{ flex: "0 0 200px" }}
          placeholder={t("page.connections.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("page.connections.all", { count: connections.length })}
        </Chip>
        {PROTOCOL_ORDER.map((p) => (
          <Chip key={p} active={filter === p} onClick={() => setFilter(p)}>
            <ProtocolIcon protocol={p} />
            {connections.filter((c) => c.protocol === p).length}
          </Chip>
        ))}
        <span style={{ flex: 1 }} />
        <SelectField value={t("page.connections.allEnvironments")} />
        <SelectField value={t("page.connections.sortRecent")} />
      </Toolbar>

      {/* Scrolls rather than clips: a long list must stay reachable, and so
          must the action column on a window narrower than the table. */}
      <div style={{ flex: 1, minHeight: 0 }} className="mqs-scroll">
        <Table className="inset">
          <THead>
            <TR>
              <TH>{t("page.connections.columnName")}</TH>
              <TH>{t("page.connections.columnProtocol")}</TH>
              <TH>{t("page.connections.columnAddress")}</TH>
              <TH>{t("page.connections.columnEnvironment")}</TH>
              <TH>{t("page.connections.columnStatus")}</TH>
              <TH>{t("page.connections.columnLastUsed")}</TH>
              <TH style={{ textAlign: "right" }}>{t("page.connections.columnActions")}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.key} onDoubleClick={() => c.protocol != null && onOpenTab?.(c.key)}>
                <TD>
                  {/* Name and star ride one line: the column is sized by content. */}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                    <b style={{ fontWeight: 500 }}>{c.name}</b>
                    {c.isDefault && (
                      <Star size={12} fill="currentColor" style={{ color: "var(--c-warn)" }} aria-label={t("page.connections.defaultConnection")} />
                    )}
                  </span>
                </TD>
                <TD>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    {c.protocol != null && <ProtocolIcon protocol={c.protocol} />}
                    {c.protocolLabel}
                  </span>
                </TD>
                {/* The one column that gives way: 20px under the `.t3` cap, which
                    is what keeps the table inside the 1024 minimum window. */}
                <TD className="mono3" style={{ color: "var(--c-mono-dim)", fontSize: "11px", maxWidth: "260px" }}>
                  {c.address}
                </TD>
                <TD>
                  {/* A profile with no group has no tag rather than an empty one. */}
                  {c.env !== "" && <EnvTag>{c.env}</EnvTag>}
                </TD>
                <TD>
                  <StatusCell connection={c} />
                </TD>
                <TD style={{ color: "var(--c-muted)" }}>{c.lastUsed}</TD>
                <TD style={{ textAlign: "right", overflow: "visible", position: "relative" }}>
                  <span className="mqs-rowhint">{t("page.connections.hoverForActions")}</span>
                  <span
                    className="mqs-rowactions"
                    style={{ position: "relative", display: "inline-flex", gap: "6px" }}
                  >
                    <RowActions connection={c} onOpenTab={c.protocol != null ? onOpenTab : undefined} />
                    <Btn
                      size="rowIcon"
                      variant={menuFor === c.key ? "primary" : "default"}
                      aria-label={t("page.connections.moreActions")}
                      onClick={() => setMenuFor(menuFor === c.key ? null : c.key)}
                    >
                      <Ellipsis size={13} aria-hidden />
                    </Btn>
                    <Menu open={menuFor === c.key} onClose={() => setMenuFor(null)}>
                      <MenuItem
                        disabled={c.isDefault}
                        onSelect={() => {
                          setMenuFor(null);
                          onSetDefault?.(c);
                        }}
                      >
                        {t("page.connections.setDefault")}
                        <Star size={11} fill="currentColor" aria-hidden />
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem
                        danger
                        onSelect={() => {
                          setMenuFor(null);
                          onDelete?.(c);
                        }}
                      >
                        {t("page.connections.delete")}
                      </MenuItem>
                    </Menu>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <StatusBar
        left={
          <span>
            {t("page.connections.summary", {
              total: connections.length,
              online,
              failed,
            })}
          </span>
        }
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <Star size={11} fill="currentColor" aria-hidden />
            {t("page.connections.defaultHint")}
          </span>
        }
      />
    </Page>
  );
}

function StatusCell({ connection }: { connection: Connection }) {
  const { t } = useTranslation();
  if (connection.status === "online") {
    return (
      <>
        <Status tone="ok" dot>
          {t("page.connections.online")}
        </Status>{" "}
        <span className="mono3" style={{ fontSize: "10px", color: "var(--c-muted)" }}>
          {connection.latency}
        </span>
      </>
    );
  }
  if (connection.status === "offline")
    return <Status tone="off">{t("page.connections.offline")}</Status>;
  return (
    <>
      <Status tone="err">{t("page.connections.failed")}</Status>{" "}
      <span style={{ fontSize: "10.5px", color: "var(--c-ok)" }}>
        {t("page.connections.logs")}
      </span>
    </>
  );
}

function RowActions({
  connection,
  onOpenTab,
}: {
  connection: Connection;
  onOpenTab?: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (connection.status === "online") {
    return (
      <>
        <Btn
          size="row"
          disabled={onOpenTab == null}
          onClick={() => onOpenTab?.(connection.key)}
        >
          {t("page.connections.openTab")}
        </Btn>
        <Btn size="row">{t("page.connections.disconnect")}</Btn>
        <Btn size="row">{t("page.connections.edit")}</Btn>
      </>
    );
  }
  if (connection.status === "offline") {
    return (
      <>
        <Btn size="row" variant="primary">
          {t("page.connections.connect")}
        </Btn>
        <Btn size="row">{t("page.connections.edit")}</Btn>
      </>
    );
  }
  return (
    <>
      <Btn size="row">{t("page.connections.retry")}</Btn>
      <Btn size="row">{t("page.connections.edit")}</Btn>
    </>
  );
}

/** The protocol filter chip row (8a toolbar). */
function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="mqs-chip"
      aria-pressed={active}
      onClick={onClick}
      style={
        active
          ? {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid var(--c-fg)",
              background: "var(--c-bar)",
              fontWeight: 500,
              borderRadius: "99px",
              padding: "3px 10px",
              fontSize: "11px",
              color: "var(--c-fg)",
            }
          : {
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              border: "1px solid var(--c-border)",
              background: "var(--c-bg)",
              borderRadius: "99px",
              padding: "3px 10px",
              fontSize: "11px",
              color: "var(--c-mono-dim)",
            }
      }
    >
      {children}
    </button>
  );
}
