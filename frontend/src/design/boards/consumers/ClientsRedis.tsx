import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Status, toast, useConfirm } from "@/components";
import { BoardState, Notice } from "@/design/boards/BoardState";
import { useRedisClients } from "@/hooks/redis/useRedisClients";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { formatIdle } from "@/mq/redis/pending";
import {
  ageSeconds,
  clientId,
  clientName,
  database,
  idleSeconds,
  isThisApp,
  lastCommand,
  library,
  peer,
  protocol,
  subscriptions,
  totalCommands,
  user,
  bytesIn,
  bytesOut,
} from "@/mq/redis/clients";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

function Metric({ value, render }: { value: number | null; render?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{render ? render(value) : formatCount(value)}</>;
}

/**
 * Board 17d — the connections open against a Redis server.
 *
 * There is no channel layer beneath them: one Redis connection runs one
 * command at a time, so unlike RabbitMQ there is nothing inside a connection to
 * enumerate and the page is one table rather than two.
 *
 * Several columns other families have are missing because Redis does not
 * report them per connection: no TLS state, no heartbeat, no channel count.
 * Drawing them as "off" or "0" would be answers the server never gave.
 */
export function ClientsRedis() {
  const { t } = useTranslation();
  const state = useRedisClients();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [hideSelf, setHideSelf] = useState(false);

  const clients = useMemo(
    () => (state.data ?? []).filter((client) => client != null),
    [state.data],
  );

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients
      .filter((client) => {
        if (hideSelf && isThisApp(client)) return false;
        if (needle === "") return true;
        return [peer(client), clientName(client), user(client), lastCommand(client)]
          .filter((value): value is string => value != null)
          .some((value) => value.toLowerCase().includes(needle));
      })
      .sort((left, right) => (idleSeconds(left) ?? 0) - (idleSeconds(right) ?? 0));
  }, [clients, hideSelf, search]);

  const close = useCallback(
    async (id: string, label: string, self: boolean) => {
      const ok = await confirm({
        title: t("board.clients.redis.closeTitle", { name: label }),
        /* Killing the connection this console is using disconnects the
           console, which is a surprising way to find out what a button does.
           It is still allowed - it is a real thing to want - but it is said
           first. */
        description: self
          ? t("board.clients.redis.closeSelf")
          : t("board.clients.redis.closeHint"),
        confirmLabel: t("board.clients.redis.close"),
        danger: true,
      });
      if (!ok) return;
      try {
        await redisApi.closeClient(connID, id);
        toast.success(t("board.clients.redis.closed", { name: label }));
        await state.refresh();
      } catch (closeError) {
        toast.error(t("board.clients.redis.closeFailed"), {
          description: formatErrorMessage(closeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.clients.redis.title")}
        subtitle={t("board.clients.redis.subtitle")}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <Toolbar>
        <Input
          className="w-72 flex-none"
          placeholder={t("board.clients.redis.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11.5px",
            color: "var(--c-mono-dim)",
          }}
        >
          <Switch checked={hideSelf} onCheckedChange={setHideSelf} />
          {t("board.clients.redis.hideSelf")}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.clients.redis.found", { count: rows.length })}
        </span>
      </Toolbar>

      <BoardState
        state={state}
        empty={
          rows.length === 0 ? (
            <Notice
              title={
                clients.length === 0
                  ? t("board.clients.redis.none")
                  : t("board.clients.redis.noMatches")
              }
            />
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.client")}</TableHead>
                  <TableHead>{t("board.common.address")}</TableHead>
                  <TableHead>{t("board.common.user")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.redis.col.database")}</TableHead>
                  <TableHead>{t("board.clients.redis.col.command")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.redis.col.idle")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.redis.col.age")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.redis.col.traffic")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((client) => {
                  const self = isThisApp(client);
                  const label = clientName(client) ?? peer(client);
                  return (
                    <TableRow key={clientId(client)}>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          {clientName(client) != null ? (
                            <span className="select-text">{clientName(client)}</span>
                          ) : (
                            <span className="text-(--c-muted-2)">
                              {t("board.clients.redis.unnamed")}
                            </span>
                          )}
                          {self && <Status tone="off">{t("board.clients.redis.thisApp")}</Status>}
                          {/* The library string can run to forty characters and is the one
                              cell nobody scans by, so it gives way first - and on this app's
                              own connections it is always this app's driver, so it is left out. */}
                          {!self && library(client) != null && (
                            <span
                              className="max-w-28 truncate text-[11px] text-(--c-muted-2)"
                              title={library(client) ?? undefined}
                            >
                              {library(client)}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {peer(client)}
                        {protocol(client) != null && (
                          <span style={{ marginLeft: "6px", color: "var(--c-muted-2)" }}>
                            {protocol(client)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="select-text">{user(client) ?? "—"}</TableCell>
                      <TableCell style={RIGHT}>{database(client) ?? "—"}</TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {lastCommand(client) ?? "—"}
                        {(subscriptions(client) ?? 0) > 0 && (
                          <Status tone="ok" style={{ marginLeft: "6px" }}>
                            sub {subscriptions(client)}
                          </Status>
                        )}
                      </TableCell>
                      <TableCell style={RIGHT}>
                        <Metric
                          value={idleSeconds(client)}
                          render={(v) => formatIdle(v * 1000)}
                        />
                      </TableCell>
                      <TableCell style={RIGHT}>
                        <Metric value={ageSeconds(client)} render={(v) => formatIdle(v * 1000)} />
                      </TableCell>
                      <TableCell style={RIGHT}>
                        {formatBytes(bytesIn(client))} / {formatBytes(bytesOut(client))}
                        {totalCommands(client) != null && (
                          <span style={{ marginLeft: "6px", color: "var(--c-muted-2)" }}>
                            {formatCount(totalCommands(client) ?? 0)} cmd
                          </span>
                        )}
                      </TableCell>
                      <TableCell style={RIGHT}>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void close(clientId(client), label, self)}
                        >
                          {t("board.clients.redis.close")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>
        </ListArea>
      </BoardState>
    </Page>
  );
}
