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
import { BoardState } from "@/design/boards/BoardState";
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
          className="w-[220px] flex-none"
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
            <ListArea>
              <ListPane>
                <div
                  style={{
                    padding: "24px",
                    fontSize: "11.5px",
                    color: "var(--c-muted)",
                    textAlign: "center",
                  }}
                >
                  {clients.length === 0
                    ? t("board.clients.redis.none")
                    : t("board.clients.redis.noMatches")}
                </div>
              </ListPane>
            </ListArea>
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.client")}</TableHead>
                  <TableHead>addr</TableHead>
                  <TableHead>user</TableHead>
                  <TableHead>db</TableHead>
                  <TableHead>cmd</TableHead>
                  <TableHead style={RIGHT}>idle</TableHead>
                  <TableHead style={RIGHT}>age</TableHead>
                  <TableHead style={RIGHT}>in / out</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((client) => {
                  const self = isThisApp(client);
                  const label = clientName(client) ?? peer(client);
                  return (
                    <TableRow key={clientId(client)}>
                      <TableCell className="mono3" style={MONO11}>
                        {clientName(client) ?? (
                          <span style={{ color: "var(--c-muted-2)" }}>
                            {t("board.clients.redis.unnamed")}
                          </span>
                        )}
                        {self && (
                          <Status tone="off" style={{ marginLeft: "6px", fontSize: "10px" }}>
                            {t("board.clients.redis.thisApp")}
                          </Status>
                        )}
                        {library(client) != null && (
                          <span style={{ marginLeft: "6px", color: "var(--c-muted-2)", fontSize: "10.5px" }}>
                            {library(client)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {peer(client)}
                        {protocol(client) != null && (
                          <span style={{ marginLeft: "6px", color: "var(--c-muted-2)" }}>
                            {protocol(client)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {user(client) ?? "—"}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {database(client) ?? "—"}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {lastCommand(client) ?? "—"}
                        {(subscriptions(client) ?? 0) > 0 && (
                          <Status tone="ok" style={{ marginLeft: "6px", fontSize: "10px" }}>
                            sub {subscriptions(client)}
                          </Status>
                        )}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric
                          value={idleSeconds(client)}
                          render={(v) => formatIdle(v * 1000)}
                        />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        <Metric value={ageSeconds(client)} render={(v) => formatIdle(v * 1000)} />
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
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
