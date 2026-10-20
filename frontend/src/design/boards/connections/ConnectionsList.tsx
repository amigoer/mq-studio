import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Ellipsis, LayoutGrid, List, Plus, RefreshCw, Star } from "lucide-react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  SelectField,
  Status,
} from "@/components";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { useHeld } from "@/lib/motion";
import { cn } from "@/lib/utils";
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

/** Where the chosen view is kept: a per-machine preference, not profile data. */
const VIEW_KEY = "mq-studio:connections-view";
type View = "grid" | "list";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

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
  const [view, setView] = useState<View>(loadView);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // A blocked store only costs the preference, never the list.
    }
  }, [view]);

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
              <Plus aria-hidden />
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(next) => next !== "" && setView(next as View)}
        >
          <ToggleGroupItem value="grid" aria-label={t("page.connections.view.grid")} title={t("page.connections.view.grid")}>
            <LayoutGrid aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label={t("page.connections.view.list")} title={t("page.connections.view.list")}>
            <List aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </Toolbar>

      {/* Scrolls rather than clips: a long list must stay reachable, and so
          must the action column on a window narrower than the table. */}
      <div style={{ flex: 1, minHeight: 0 }} className="mqs-scroll">
        {view === "grid" ? (
          rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 px-5 py-14 text-center text-muted-foreground">
              {t("page.connections.noMatch")}
              <Button variant="outline" size="xs" onClick={clearFilters}>
                {t("page.connections.clearFilters")}
              </Button>
            </div>
          ) : (
            <div className="mqs-conngrid">
              {rows.map((c) => (
                <ConnectionCard
                  key={c.key}
                  connection={c}
                  selected={selected.has(c.key)}
                  selecting={selected.size > 0}
                  error={errors?.[c.id]}
                  onPick={(range) => pick(c.key, range)}
                  onOpenTab={c.protocol != null ? onOpenTab : undefined}
                  action={
                    <PrimaryAction
                      connection={c}
                      op={pending?.[c.id]}
                      queued={queued.has(c.key)}
                      onOpenTab={c.protocol != null ? onOpenTab : undefined}
                      onConnect={onConnect}
                    />
                  }
                  menu={
                    <ConnectionMenu
                      connection={c}
                      trigger="ghost"
                      onOpenTab={onOpenTab}
                      onDisconnect={onDisconnect}
                      onTest={onTest}
                      onEdit={onEdit}
                      onSetDefault={onSetDefault}
                      onDelete={onDelete}
                    />
                  }
                />
              ))}
              {!filtered && (
                <button type="button" className="mqs-conngrid-new" onClick={onNewConnection}>
                  <Plus className="size-4" aria-hidden />
                  {t("page.connections.new")}
                </button>
              )}
            </div>
          )
        ) : (
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
                      <ConnectionMenu
                        connection={c}
                        onOpenTab={onOpenTab}
                        onDisconnect={onDisconnect}
                        onTest={onTest}
                        onEdit={onEdit}
                        onSetDefault={onSetDefault}
                        onDelete={onDelete}
                      />
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
        )}
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
      className="h-7 min-w-0 gap-1.5 rounded-full bg-background px-2.5 text-xs font-normal text-(--c-fg-2) shadow-none tabular-nums hover:bg-(--c-fill-soft) data-[state=on]:border-(--c-border-strong) data-[state=on]:bg-(--c-fill) data-[state=on]:font-medium data-[state=on]:text-foreground"
    >
      {children}
    </Toggle>
  );
}

/**
 * The row's overflow menu: everything a connection can have done to it beyond
 * its primary action. Shared by the card and the table row.
 */
function ConnectionMenu({
  connection: c,
  trigger = "outline",
  onOpenTab,
  onDisconnect,
  onTest,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  connection: Connection;
  /** The card sits on its own border, so its trigger draws none. */
  trigger?: "outline" | "ghost";
  onOpenTab?: (key: string) => void;
  onDisconnect?: (connection: Connection) => void;
  onTest?: (connection: Connection) => void;
  onEdit?: (connection: Connection) => void;
  onSetDefault?: (connection: Connection) => void;
  onDelete?: (connection: Connection) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={trigger}
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
  );
}

/**
 * One connection as a card in the grid view: what it is, where it points and
 * whether it is up, with the same gestures as a table row - double-click
 * opens it, Cmd/Ctrl/Shift-click selects, and the tick box appears on hover.
 */
function ConnectionCard({
  connection: c,
  selected,
  selecting,
  error,
  onPick,
  onOpenTab,
  action,
  menu,
}: {
  connection: Connection;
  selected: boolean;
  /** Something is ticked, so every card shows its box rather than on hover. */
  selecting: boolean;
  error?: string;
  onPick: (range: boolean) => void;
  onOpenTab?: (key: string) => void;
  action: ReactNode;
  menu: ReactNode;
}) {
  const { t } = useTranslation();
  const used = lastUsedLabel(c.lastUsed);
  return (
    <div
      data-slot="connection-card"
      data-state={selected ? "selected" : undefined}
      className="group/card relative flex min-w-0 flex-col rounded-xl border bg-card transition-[border-color,box-shadow] duration-(--mo-fast) hover:border-(--c-border-strong) hover:shadow-[0_4px_14px_-6px_rgba(28,25,23,0.14)] data-[state=selected]:border-(--c-fg-2) data-[state=selected]:shadow-[0_0_0_3px_rgba(28,25,23,0.06)]"
      onDoubleClick={() => onOpenTab?.(c.key)}
      onMouseDown={(event) => {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey || event.shiftKey)) return;
        if (event.target instanceof Element && event.target.closest("button, a, input")) return;
        event.preventDefault();
        onPick(event.shiftKey);
      }}
    >
      <div className="flex items-start gap-3 px-4 pt-4" title={c.remark !== "" ? c.remark : undefined}>
        <span
          role="img"
          aria-label={c.protocolLabel}
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-[10px]",
            c.protocol != null ? PROTOCOLS[c.protocol].badgeClass : "bg-(--c-fill) text-[10px] text-muted-foreground",
          )}
        >
          {c.protocol != null ? <ProtocolIcon protocol={c.protocol} size={20} className="" /> : c.protocolLabel.slice(0, 3)}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-1.5">
            <b className="truncate text-[14px] leading-tight font-semibold select-text">{c.name}</b>
            {c.isDefault && (
              <Star
                size={12}
                fill="currentColor"
                className="flex-none text-(--c-warn)"
                aria-label={t("page.connections.defaultConnection")}
              />
            )}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {c.protocolLabel}
            {c.remark !== "" && ` · ${c.remark}`}
          </div>
        </div>
        <div className="-mt-1 -mr-2 flex flex-none items-center gap-1">
          <span
            className={cn(
              "flex size-6 items-center justify-center opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100",
              (selected || selecting) && "opacity-100",
            )}
          >
            <Checkbox
              checked={selected}
              aria-label={t("page.connections.bulk.selectRow", { name: c.name })}
              onMouseDown={(event) => {
                if (event.shiftKey) event.preventDefault();
              }}
              onClick={(event) => {
                event.preventDefault();
                onPick(event.shiftKey);
              }}
            />
          </span>
          {menu}
        </div>
      </div>

      <div className="mx-4 mt-3.5 flex min-w-0 items-center gap-2 rounded-md bg-(--c-fill-soft) px-2.5 py-1.5 ring-1 ring-(--c-rule) ring-inset">
        <span className="mono3 truncate text-[11.5px] text-(--c-mono-dim)" title={c.address}>
          {c.address}
        </span>
        {c.scope != null && (
          <span className="mono3 ml-auto flex-none truncate text-[11px] text-muted-foreground">{c.scope}</span>
        )}
      </div>

      <div className="mx-4 mt-2 text-[11px] text-muted-foreground tabular-nums">
        {t("page.connections.columnLastUsed")} {used}
      </div>

      {c.status === "failed" && error != null && error !== "" && (
        <p className="mx-4 mt-2 mb-0 line-clamp-2 text-[11.5px] leading-snug text-(--c-err-text)" title={error}>
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 px-4 pt-3.5 pb-3.5">
        <CardStatus connection={c} />
        <span className="ml-auto">{action}</span>
      </div>
    </div>
  );
}

/** The card's state line: the table's status cell without the failure reason, which the card sets out on its own. */
function CardStatus({ connection }: { connection: Connection }) {
  const { t } = useTranslation();
  if (connection.status === "online") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Status tone="ok" dot>
          {t("page.connections.online")}
        </Status>
        {connection.latency != null && (
          <span className="text-[11px] text-muted-foreground tabular-nums">{connection.latency}</span>
        )}
      </span>
    );
  }
  if (connection.status === "failed") {
    return (
      <Status tone="err" dot>
        {t("page.connections.failed")}
      </Status>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span className="size-1.5 rounded-full border border-current" aria-hidden />
      {t("page.connections.offline")}
    </span>
  );
}
