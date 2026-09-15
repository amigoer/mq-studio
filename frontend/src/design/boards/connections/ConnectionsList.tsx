import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Ellipsis, RefreshCw, Star } from "lucide-react";
import { Page, PageHeader, Toolbar, StatusBar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toggle } from "@/components/ui/toggle";
import {
  SelectField,
  Status,
} from "@/components";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { useHeld } from "@/lib/motion";
import type { Connection, ConnectionStatus } from "@/design/data/connections";
import type { ConnectionOp } from "@/hooks/useConnectionProfiles";
import { PROTOCOLS, PROTOCOL_ORDER, type ProtocolId } from "@/design/data/protocols";
import {
  bulkTargets,
  clickSelection,
  headerChecked,
  type BulkAction,
} from "./connectionSelection";
import type { BulkRun } from "./useConnectionBulk";

/** Where a key press belongs to the control that has focus, not to the list. */
const OWNS_KEYS =
  "input, textarea, select, [contenteditable], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']";

/** The orders the toolbar offers; each key is also its label's suffix. */
const SORTS = ["recent", "name", "status"] as const;
type Sort = (typeof SORTS)[number];

/** Health order: what is up, then what broke, then what was never dialled. */
const STATUS_RANK: Record<ConnectionStatus, number> = { online: 0, failed: 1, offline: 2 };

/**
 * The status column while a row is carrying a failure reason. A dial's reason
 * is the one cell in the table with no natural length, and an auto-width column
 * sized to fit one pushes every column after it past the window edge. Zero
 * max-width drops the reason out of the column's measurement; the share of the
 * table it is handed instead is what the reason ellipses into.
 */
const FAILURE_COLUMN = { width: "36%", maxWidth: 0 } as const;

/**
 * `2026-08-30 10:22:11` -> `08-30 10:22`. Go writes `-` for a profile it has
 * never dialled, and the year is noise in a column that is scanned, not read.
 */
function lastUsedLabel(value: string): string {
  const stamp = /^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/.exec(value);
  return stamp != null ? `${stamp[1]} ${stamp[2]}` : "—";
}

/**
 * Board 8a — the global connection list.
 *
 * Five columns, not seven: the protocol rides the name as its brand mark and
 * the address takes the slack the table used to spread between them, so a row
 * carries its identity, where it points and what it is doing in one scan.
 */
export function ConnectionsList({
  connections,
  pending,
  errors,
  onNewConnection,
  onOpenTab,
  onDelete,
  onSetDefault,
  onImport,
  onExport,
  onConnect,
  onDisconnect,
  onTest,
  onEdit,
  bulk,
  onBulk,
  onStopBulk,
}: {
  connections: readonly Connection[];
  /** What each row is waiting on, so it can say so and refuse a second click. */
  pending?: Readonly<Record<number, ConnectionOp | undefined>>;
  /** What the last dial reported, per connection id. */
  errors?: Readonly<Record<number, string | undefined>>;
  /** The bulk action under way, which may have been started before this mounted. */
  bulk?: BulkRun | null;
  onBulk?: (action: BulkAction, connections: readonly Connection[]) => void;
  onStopBulk?: () => void;
  onNewConnection?: () => void;
  onOpenTab?: (key: string) => void;
  onDelete?: (connection: Connection) => void;
  onSetDefault?: (connection: Connection) => void;
  onImport?: () => void;
  onExport?: () => void;
  onConnect?: (connection: Connection) => void;
  onDisconnect?: (connection: Connection) => void;
  onTest?: (connection: Connection) => void;
  onEdit?: (connection: Connection) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ProtocolId | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  /* Only the families actually stored get a chip: five zeroes above three rows
     was most of what the filter row was saying. */
  const present = PROTOCOL_ORDER.filter((p) => connections.some((c) => c.protocol === p));

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = connections.filter(
      (c) =>
        (filter === "all" || c.protocol === filter) &&
        (needle === "" ||
          c.name.toLowerCase().includes(needle) ||
          c.address.toLowerCase().includes(needle) ||
          c.remark.toLowerCase().includes(needle)),
    );
    const byName = (a: Connection, b: Connection) => a.name.localeCompare(b.name);
    return [...matched].sort((a, b) => {
      if (sort === "name") return byName(a, b);
      if (sort === "status")
        return STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a, b);
      // Go's stamp is fixed-width, so newest-first is a plain reverse compare
      // and the `-` of a never-dialled profile sorts to the bottom on its own.
      return b.lastUsed.localeCompare(a.lastUsed) || byName(a, b);
    });
  }, [connections, filter, query, sort]);

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  // The row a shift-click extends from: the one last ticked or cleared.
  const anchor = useRef<string | null>(null);

  /* A filter drops what it hides from the selection, and a deleted row goes
     with it, so a bulk action can only ever reach rows that are on screen. */
  useEffect(() => {
    setSelected((current) => {
      const kept = [...current].filter((key) => rows.some((c) => c.key === key));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [rows]);

  /* Esc and Cmd+A as a file list has them, unless a field, dialog or menu has
     focus and the key is its own. Radix marks an Esc it used to close a layer
     as handled, so closing a menu does not also clear the selection. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(OWNS_KEYS)) return;
      if (event.key === "Escape") {
        setSelected((current) => (current.size === 0 ? current : new Set()));
      } else if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        event.preventDefault();
        setSelected(new Set(rows.map((c) => c.key)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows]);

  const picked = useMemo(() => rows.filter((c) => selected.has(c.key)), [rows, selected]);
  const queued = new Set(bulk != null ? bulk.keys.slice(bulk.done + 1) : []);
  const barOpen = picked.length > 0 || bulk != null;
  // Held while the bar leaves, so it goes as it was rather than reading zero.
  const bar = useHeld(
    useMemo(() => ({ selection: picked, run: bulk ?? null }), [picked, bulk]),
    !barOpen,
  );

  const pick = (key: string, range: boolean) => {
    // Read now: the updater may run after the anchor below has moved.
    const from = anchor.current;
    setSelected((current) => clickSelection(current, rows, key, from, range));
    anchor.current = key;
  };

  const showsFailure = rows.some((c) => c.status === "failed" && (errors?.[c.id] ?? "") !== "");

  const online = connections.filter((c) => c.status === "online").length;
  const failed = connections.filter((c) => c.status === "failed").length;
  const filtered = rows.length !== connections.length;

  const clearFilters = () => {
    setFilter("all");
    setQuery("");
  };

  return (
    <Page>
      <PageHeader
        title={t("page.connections.title")}
        subtitle={t("page.connections.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={onImport}>{t("page.connections.import")}</Button>
            <Button variant="outline" onClick={onExport}>{t("page.connections.export")}</Button>
            <Button onClick={onNewConnection}>
              {t("page.connections.new")}
            </Button>
          </>
        }
      />

      <Toolbar>
        <Input
          className="w-[200px] flex-none"
          placeholder={t("page.connections.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* One family stored means nothing to filter between. */}
        {present.length > 1 && (
          <>
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              {t("page.connections.all", { count: connections.length })}
            </Chip>
            {present.map((p) => (
              <Chip
                key={p}
                active={filter === p}
                /* The count is all the chip inks; the mark that says which
                   family it counts is an icon, and icons are aria-hidden. */
                label={PROTOCOLS[p].name}
                onClick={() => setFilter(p)}
              >
                <ProtocolIcon protocol={p} />
                {connections.filter((c) => c.protocol === p).length}
              </Chip>
            ))}
          </>
        )}
        <span className="flex-1" />
        <span style={{ display: "inline-flex" }}>
          <SelectField
            value={sort}
            onValueChange={setSort}
            options={SORTS.map((key) => ({
              value: key,
              label: t(`page.connections.sort.${key}`),
            }))}
          />
        </span>
      </Toolbar>

      {/* Scrolls rather than clips: a long list must stay reachable, and so
          must the action column on a window narrower than the table. */}
      <div style={{ flex: 1, minHeight: 0 }} className="mqs-scroll">
        <Table inset>
          {/* Column heads over a single "nothing matched" cell come out
              squeezed against the table's edges, so they stand down. */}
          {rows.length > 0 && (
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: "34px" }}>
                  <Checkbox
                    checked={headerChecked(rows, selected)}
                    aria-label={t("board.common.selectAll")}
                    onCheckedChange={(next) => {
                      anchor.current = null;
                      setSelected(next === true ? new Set(rows.map((c) => c.key)) : new Set());
                    }}
                  />
                </TableHead>
                {/* Minimums keep short values from cramming the columns into
                    each other; longer values still widen them naturally. */}
                <TableHead style={{ minWidth: "200px" }}>{t("page.connections.columnConnection")}</TableHead>
                <TableHead style={{ minWidth: "240px" }}>{t("page.connections.columnAddress")}</TableHead>
                <TableHead style={{ minWidth: "104px", ...(showsFailure ? FAILURE_COLUMN : null) }}>
                  {t("page.connections.columnStatus")}
                </TableHead>
                <TableHead style={{ minWidth: "104px" }}>{t("page.connections.columnLastUsed")}</TableHead>
                <TableHead className="fill" role="presentation" />
                <TableHead style={{ textAlign: "right" }}>{t("page.connections.columnActions")}</TableHead>
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {rows.map((c) => (
              <TableRow
                key={c.key}
                selected={selected.has(c.key)}
                onDoubleClick={() => c.protocol != null && onOpenTab?.(c.key)}
                /* Cmd-click and shift-click on the row itself, as in Finder. A
                   plain click stays inert: it is half of the double-click that
                   opens a tab. */
                onMouseDown={(event) => {
                  if (event.button !== 0 || !(event.metaKey || event.ctrlKey || event.shiftKey)) return;
                  if (event.target instanceof Element && event.target.closest("button, a, input")) return;
                  // Shift would otherwise sweep a text selection across the rows.
                  event.preventDefault();
                  pick(c.key, event.shiftKey);
                }}
              >
                {/* A double-click here is two ticks, not a request for a tab. */}
                <TableCell onDoubleClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(c.key)}
                    aria-label={t("page.connections.bulk.selectRow", { name: c.name })}
                    onMouseDown={(event) => {
                      if (event.shiftKey) event.preventDefault();
                    }}
                    onClick={(event) => {
                      // Handled here rather than in onCheckedChange, which never
                      // sees the shift key.
                      event.preventDefault();
                      pick(c.key, event.shiftKey);
                    }}
                  />
                </TableCell>
                <TableCell title={c.remark !== "" ? c.remark : undefined}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    {/* The brand mark is the protocol column: it names itself to
                        a screen reader and on hover, and a family the design has
                        no icon for falls back to its raw kind. */}
                    {c.protocol != null ? (
                      <span
                        role="img"
                        aria-label={c.protocolLabel}
                        title={c.protocolLabel}
                        style={{ display: "inline-flex", flex: "none" }}
                      >
                        <ProtocolIcon protocol={c.protocol} />
                      </span>
                    ) : (
                      <span style={{ fontSize: "10px", color: "var(--c-muted)" }}>
                        {c.protocolLabel}
                      </span>
                    )}
                    <b style={{ fontWeight: 500 }}>{c.name}</b>
                    {c.isDefault && (
                      <Star
                        size={12}
                        fill="currentColor"
                        style={{ color: "var(--c-warn)", flex: "none" }}
                        aria-label={t("page.connections.defaultConnection")}
                      />
                    )}
                    {c.remark !== "" && (
                      <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>{c.remark}</span>
                    )}
                  </span>
                </TableCell>
                {/* Room for a three-broker bootstrap list before the ellipsis. */}
                <TableCell
                  className="mono3"
                  style={{ color: "var(--c-mono-dim)", fontSize: "11px", maxWidth: "420px" }}
                >
                  {c.address}
                  {c.scope != null && (
                    <span style={{ color: "var(--c-muted)" }}> · {c.scope}</span>
                  )}
                </TableCell>
                <TableCell style={showsFailure ? FAILURE_COLUMN : undefined}>
                  <StatusCell connection={c} error={errors?.[c.id]} />
                </TableCell>
                <TableCell style={{ color: "var(--c-muted)" }}>{lastUsedLabel(c.lastUsed)}</TableCell>
                <TableCell className="fill" role="presentation" />
                <TableCell style={{ textAlign: "right", overflow: "visible" }}>
                  <span style={{ position: "relative", display: "inline-flex", gap: "6px" }}>
                    <PrimaryAction
                      connection={c}
                      op={pending?.[c.id]}
                      queued={queued.has(c.key)}
                      onOpenTab={c.protocol != null ? onOpenTab : undefined}
                      onConnect={onConnect}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon-xs"
                          aria-label={t("page.connections.moreActions")}
                        >
                          <Ellipsis size={13} aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          {/* Opening a tab is the double-click, spelled out: the
                              rows that do not carry it as their primary button are
                              the ones whose gesture is hardest to guess. */}
                          {c.protocol != null && c.status !== "online" && (
                            <DropdownMenuItem onSelect={() => onOpenTab?.(c.key)}>
                              {t("page.connections.openTab")}
                            </DropdownMenuItem>
                          )}
                          {c.status === "online" && (
                            <DropdownMenuItem onSelect={() => onDisconnect?.(c)}>
                              {t("page.connections.disconnect")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => onTest?.(c)}>
                            {t("page.connections.test")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => onEdit?.(c)}>
                            {t("page.connections.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={c.isDefault} onSelect={() => onSetDefault?.(c)}>
                            {t("page.connections.setDefault")}
                            <Star size={11} fill="currentColor" aria-hidden />
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem variant="destructive" onSelect={() => onDelete?.(c)}>
                            {t("page.connections.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {/* A search that matches nothing used to leave a bare header. */}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} style={{ padding: "38px 20px", textAlign: "center" }}>
                  <div style={{ color: "var(--c-muted)", marginBottom: "10px" }}>
                    {t("page.connections.noMatch")}
                  </div>
                  <Button variant="outline" size="xs" onClick={clearFilters}>
                    {t("page.connections.clearFilters")}
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* The footer and the selection bar take turns in one slot; tokens.css
          has the swap. The one not showing is inert, so it cannot be tabbed to. */}
      <div className="mqs-footer-swap" data-state={barOpen ? "open" : "closed"}>
        <div data-layer="status" inert={barOpen}>
          <StatusBar
            left={
              <span>
                {filtered
                  ? t("page.connections.summaryFiltered", {
                      shown: rows.length,
                      total: connections.length,
                    })
                  : t("page.connections.summary", {
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
        </div>
        <div data-layer="bulk" inert={!barOpen}>
          <SelectionBar
            selection={bar.selection}
            pending={pending}
            run={bar.run}
            onRun={(action) => onBulk?.(action, picked)}
            onClear={() => setSelected(new Set())}
            onStop={onStopBulk}
          />
        </div>
      </div>
    </Page>
  );
}

/**
 * What the footer becomes while rows are ticked: how many, and what can be done
 * to them. An action that would reach fewer rows than are ticked counts them -
 * connecting five rows of which two are already up dials three - and one that
 * would reach none stays disabled rather than doing nothing when pressed.
 */
function SelectionBar({
  selection,
  pending,
  run,
  onRun,
  onClear,
  onStop,
}: {
  selection: readonly Connection[];
  pending?: Readonly<Record<number, ConnectionOp | undefined>>;
  run?: BulkRun | null;
  onRun: (action: BulkAction) => void;
  onClear: () => void;
  onStop?: () => void;
}) {
  const { t } = useTranslation();

  const action = (key: BulkAction, label: string, className?: string) => {
    const reach = bulkTargets(key, selection, pending).length;
    return (
      <Button
        variant="outline"
        size="xs"
        className={className}
        disabled={run != null || reach === 0}
        onClick={() => onRun(key)}
      >
        {label}
        {reach > 0 && reach < selection.length && (
          <span className="tabular-nums opacity-60">{reach}</span>
        )}
      </Button>
    );
  };

  return (
    <div
      className="relative flex h-full items-center gap-1.5 border-t bg-(--c-panel) px-5 py-1"
      style={{ fontSize: "11px" }}
    >
      {run != null && (
        <Progress
          value={(run.done / run.keys.length) * 100}
          aria-label={t(`page.connections.bulk.running.${run.action}`, {
            current: Math.min(run.done + 1, run.keys.length),
            total: run.keys.length,
          })}
          className="absolute inset-x-0 top-0 h-0.5 rounded-none bg-transparent"
        />
      )}
      <span className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground" aria-live="polite">
        {run == null ? (
          <Trans
            i18nKey="page.connections.bulk.selected"
            values={{ count: selection.length }}
            components={{ b: <b className="font-semibold text-foreground tabular-nums" /> }}
          />
        ) : (
          <>
            <RefreshCw size={11} className="mqs-turning" aria-hidden />
            <span className="tabular-nums">
              {run.stopping
                ? t("page.connections.bulk.stopping")
                : t(`page.connections.bulk.running.${run.action}`, {
                    current: Math.min(run.done + 1, run.keys.length),
                    total: run.keys.length,
                  })}
            </span>
          </>
        )}
      </span>
      {action("connect", t("page.connections.connect"))}
      {action("disconnect", t("page.connections.disconnect"))}
      {action("test", t("page.connections.bulk.test"))}
      {action("delete", t("page.connections.deleteAction"), "text-destructive hover:text-destructive")}
      <span className="flex-1" />
      {run == null ? (
        <Button variant="ghost" size="xs" onClick={onClear}>
          {t("page.connections.bulk.clear")}
          <span className="text-muted-foreground">Esc</span>
        </Button>
      ) : (
        <Button variant="ghost" size="xs" disabled={run.stopping} onClick={onStop}>
          {t("page.connections.bulk.stop")}
        </Button>
      )}
    </div>
  );
}

/**
 * Resting state is the quiet one: only a connection that is up or that broke
 * earns a tinted pill, so a list of untouched profiles reads as a list of
 * names rather than a column of identical grey badges.
 */
function StatusCell({ connection, error }: { connection: Connection; error?: string }) {
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
  if (connection.status === "offline") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "11px",
          color: "var(--c-muted)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "99px",
            border: "1px solid currentColor",
          }}
          aria-hidden
        />
        {t("page.connections.offline")}
      </span>
    );
  }
  /* What went wrong is the useful half of a failed row. The canvas put a
     "日志" link here, back when the reason lived somewhere else; the reason is
     in hand now, so it says it, with the untruncated text on hover. */
  return (
    <span
      style={{ display: "flex", alignItems: "baseline", gap: "6px", minWidth: 0 }}
      title={error}
    >
      <Status tone="err" dot className="flex-none">
        {t("page.connections.failed")}
      </Status>
      {error != null && (
        <span
          style={{
            // Shrinks past its text so FAILURE_COLUMN, not the reason, sets the
            // column's width; whatever does not fit is on hover.
            minWidth: 0,
            fontSize: "10.5px",
            color: "var(--c-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * The one action a row keeps outside the menu. It no longer waits for hover:
 * the list is short and the hint that used to stand in for it ("悬停显示操作")
 * repeated itself once per row without ever saying anything about the row.
 */
function PrimaryAction({
  connection,
  op,
  queued,
  onOpenTab,
  onConnect,
}: {
  connection: Connection;
  op?: ConnectionOp;
  /** Waiting for its turn in a bulk action, which says so in place of the button. */
  queued?: boolean;
  onOpenTab?: (key: string) => void;
  onConnect?: (connection: Connection) => void;
}) {
  const { t } = useTranslation();
  if (op != null) {
    return (
      <Button variant="outline" size="xs" disabled>
        <RefreshCw size={11} className="mqs-turning" aria-hidden />
        {t(`page.connections.${op}`)}
      </Button>
    );
  }
  if (queued) {
    return (
      <Button variant="outline" size="xs" disabled>
        {t("page.connections.bulk.queued")}
      </Button>
    );
  }
  if (connection.status === "online") {
    return (
      <Button variant="outline" size="xs" disabled={onOpenTab == null} onClick={() => onOpenTab?.(connection.key)}>
        {t("page.connections.openTab")}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="xs" disabled={onConnect == null} onClick={() => onConnect?.(connection)}>
      {connection.status === "offline"
        ? t("page.connections.connect")
        : t("page.connections.retry")}
    </Button>
  );
}

/** The protocol filter chip row (8a toolbar). */
function Chip({
  active,
  label,
  children,
  onClick,
}: {
  active?: boolean;
  /** Set where the chip's own text does not name what it filters. */
  label?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Toggle
      variant="outline"
      pressed={Boolean(active)}
      aria-label={label}
      title={label}
      onPressedChange={() => onClick?.()}
      className="h-auto gap-1 rounded-full bg-background px-2.5 py-[3px] text-xs font-normal text-(--c-mono-dim) data-[state=on]:border-foreground data-[state=on]:bg-(--c-bar) data-[state=on]:font-medium data-[state=on]:text-foreground"
    >
      {children}
    </Toggle>
  );
}
