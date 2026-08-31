import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
  DetailPanel,
  DetailPanelBody,
  DetailPanelFooter,
  DetailPanelHeader,
  KV,
  Panel,
  SectionLabel,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useRabbitNamespaces } from "@/hooks/rabbitmq/useRabbitNamespaces";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import * as rabbitApi from "@/api/rabbitmq";
import { LIMIT_MAX_CONNECTIONS, LIMIT_MAX_QUEUES } from "@/api/rabbitmq";
import { VhostDialog } from "./VhostDialog";
import type { Namespace, NamespaceInput } from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** The root virtual host, which exists on every broker and cannot be replaced. */
const ROOT = "/";

/**
 * RabbitMQ virtual hosts.
 *
 * A page rather than a filter, because a vhost is not a label. Queues,
 * exchanges, bindings, policies and permissions all live inside one and
 * nothing crosses between them, so two vhosts can hold a queue of the same
 * name that have nothing to do with each other.
 *
 * The default queue type is the field worth setting and the one nobody knows
 * is there: it decides what a queue declared without a type becomes, and
 * setting it to quorum is how a cluster stops accumulating classic queues by
 * accident.
 */
export function VhostsRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitNamespaces();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Namespace | null>(null);
  const [creating, setCreating] = useState(false);

  const namespaces = useMemo(() => state.data ?? [], [state.data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return namespaces
      .filter((vhost) => needle === "" || vhost.name.toLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [namespaces, search]);

  const detail = rows.find((vhost) => vhost.name === selected) ?? null;

  const save = useCallback(
    async (input: NamespaceInput) => {
      await rabbitApi.saveNamespace(connID, input);
      toast.success(t("board.vhosts.rabbitmq.saved", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (vhost: Namespace) => {
      const ok = await confirm({
        title: t("board.vhosts.rabbitmq.deleteTitle", { name: vhost.name }),
        /* Everything means everything: queues, their messages, exchanges,
           bindings, policies and permissions. The broker does not ask. */
        description: t("board.vhosts.rabbitmq.deleteDesc", { count: vhost.messages }),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteNamespace(connID, vhost.name);
        toast.success(t("board.vhosts.rabbitmq.deleted", { name: vhost.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.vhosts.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const setLimit = useCallback(
    async (vhost: Namespace, limit: string, raw: string) => {
      /* An empty field lifts the cap. That is a different instruction from a
         cap of zero, which forbids everything, and the driver needs to be able
         to tell them apart - so blank becomes -1 rather than 0. */
      const value = raw.trim() === "" ? -1 : Number.parseInt(raw.trim(), 10);
      if (Number.isNaN(value)) return;
      try {
        await rabbitApi.setNamespaceLimit(connID, vhost.name, limit, value);
        toast.success(
          value < 0
            ? t("board.vhosts.rabbitmq.limitLifted", { limit })
            : t("board.vhosts.rabbitmq.limitSet", { limit, value }),
        );
        await state.refresh();
      } catch (limitError) {
        toast.error(t("board.vhosts.rabbitmq.limitFailed"), {
          description: formatErrorMessage(limitError),
        });
      }
    },
    [connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.vhosts.rabbitmq.title")}
        subtitle={t("board.vhosts.rabbitmq.subtitle", { count: namespaces.length })}
        actions={
          <>
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              {t("board.vhosts.rabbitmq.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={state.refresh}
            />
          </>
        }
      />
      <VhostDialog
        open={creating || editing != null}
        editing={editing ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={save}
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Input
            className="w-[220px] flex-none"
            placeholder={t("board.vhosts.rabbitmq.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={namespaces.length === 0 ? t("board.vhosts.rabbitmq.none") : undefined}
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.vhosts.rabbitmq.name")}</TableHead>
                  <TableHead>{t("board.vhosts.rabbitmq.defaultQueueType")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>Ready</TableHead>
                  <TableHead style={{ textAlign: "right" }}>Unacked</TableHead>
                  <TableHead>{t("board.vhosts.rabbitmq.limits")}</TableHead>
                  <TableHead>{t("board.common.features")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((vhost) => (
                  <TableRow
                    key={vhost.name}
                    selected={selected === vhost.name}
                    onClick={() => setSelected(vhost.name)}
                  >
                    <TableCell className="mono3">
                      <b style={{ fontWeight: 500 }}>{vhost.name}</b>
                      {vhost.description !== "" && (
                        <span
                          style={{ marginLeft: "8px", fontSize: "10.5px", color: "var(--c-muted)" }}
                        >
                          {vhost.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Absent means the broker's own default, which is
                          classic - worth saying rather than leaving blank. */}
                      {vhost.defaultQueueType !== ""
                        ? vhost.defaultQueueType
                        : t("board.vhosts.rabbitmq.brokerDefault")}
                    </TableCell>
                    <TableCell
                      className="mono3"
                      style={{
                        textAlign: "right",
                        color: vhost.ready > 0 ? "var(--c-warn-text)" : undefined,
                      }}
                    >
                      {formatCount(vhost.ready)}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {formatCount(vhost.unacknowledged)}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {summariseLimits(vhost, t)}
                    </TableCell>
                    <TableCell>
                      {vhost.tracing && (
                        <Status tone="warn" style={TAG}>
                          tracing
                        </Status>
                      )}
                      {(vhost.tags ?? []).map((tag) => (
                        <Status key={tag} tone="off" style={TAG}>
                          {tag}
                        </Status>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && namespaces.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={6} style={{ color: "var(--c-muted)" }}>
                      {t("board.vhosts.rabbitmq.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={380} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader title={detail.name} onClose={() => setSelected(null)} />
            <DetailPanelBody>
              <VhostDetail vhost={detail} onSetLimit={setLimit} />
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline" onClick={() => setEditing(detail)}>
                {t("board.common.edit")}
              </Button>
              <span className="flex-1" />
              {/* The root virtual host exists on every broker, every default
                  connection uses it, and deleting it is not a recoverable
                  mistake. */}
              {detail.name !== ROOT && (
                <Button variant="destructive" onClick={() => void remove(detail)}>
                  {t("board.common.delete")}
                </Button>
              )}
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/** The limits column, which has to say "none" rather than nothing. */
function summariseLimits(vhost: Namespace, t: (key: string) => string): string {
  const limits = vhost.limits ?? {};
  const parts = Object.entries(limits).map(([name, value]) => `${name} ${value}`);
  return parts.length > 0 ? parts.join(" · ") : t("board.vhosts.rabbitmq.noLimits");
}

function VhostDetail({
  vhost,
  onSetLimit,
}: {
  vhost: Namespace;
  onSetLimit: (vhost: Namespace, limit: string, value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <KV
        rows={[
          [t("board.vhosts.rabbitmq.description"), vhost.description || "-"],
          [
            t("board.vhosts.rabbitmq.defaultQueueType"),
            vhost.defaultQueueType || t("board.vhosts.rabbitmq.brokerDefault"),
          ],
          [
            t("board.vhosts.rabbitmq.tracing"),
            vhost.tracing
              ? t("board.vhosts.rabbitmq.tracingOn")
              : t("board.vhosts.rabbitmq.tracingOff"),
          ],
          [t("board.common.backlog"), formatCount(vhost.messages)],
        ]}
      />

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.vhosts.rabbitmq.limits")}
        </SectionLabel>
        <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <LimitRow
            label={t("board.vhosts.rabbitmq.maxConnections")}
            value={vhost.limits?.[LIMIT_MAX_CONNECTIONS]}
            onApply={(next) => onSetLimit(vhost, LIMIT_MAX_CONNECTIONS, next)}
          />
          <LimitRow
            label={t("board.vhosts.rabbitmq.maxQueues")}
            value={vhost.limits?.[LIMIT_MAX_QUEUES]}
            onApply={(next) => onSetLimit(vhost, LIMIT_MAX_QUEUES, next)}
          />
          <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
            {t("board.vhosts.rabbitmq.limitHint")}
          </span>
        </Panel>
      </div>
    </>
  );
}

/**
 * One limit, editable in place.
 *
 * An empty field is not zero. Blank lifts the cap; zero forbids everything,
 * which on max-connections means nothing can connect at all.
 */
function LimitRow({
  label,
  value,
  onApply,
}: {
  label: string;
  value: number | undefined;
  onApply: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value == null ? "" : String(value));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ flex: 1, fontSize: "11.5px" }}>{label}</span>
      <Input
        type="number"
        min={0}
        className="w-[110px]"
        value={draft}
        placeholder={t("board.vhosts.rabbitmq.noLimit")}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button size="xs" variant="outline" onClick={() => onApply(draft)}>
        {t("board.common.apply")}
      </Button>
    </div>
  );
}
