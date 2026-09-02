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
  SectionLabel,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useNatsClients } from "@/hooks/nats/useNatsClients";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as natsApi from "@/api/nats";
import { formatBytes, formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import type { ClientConnection } from "@bindings/model/models";
import {
  account,
  canBeClosed,
  cipher,
  clientId,
  clientName,
  connectedAtMs,
  connectionKey,
  idleFor,
  inMessages,
  isEncrypted,
  kind,
  language,
  libraryVersion,
  outMessages,
  peer,
  pendingBytes,
  receivedBytes,
  roundTrip,
  sentBytes,
  serverOf,
  subjects,
  transport,
  user,
} from "@/mq/nats/clients";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

function Metric({ value, format }: { value: number | null; format?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{format ? format(value) : formatCount(value)}</>;
}

/**
 * The connections the cluster is holding.
 *
 * The subject column is what makes this board worth opening, and it is the
 * only answer NATS has to "what is this client doing": outside JetStream there
 * is no consumer object to look one up in, so what a connection is subscribed
 * to is the whole of its behaviour.
 *
 * Pending bytes is the other one. It is what the server has written for a
 * client and not had accepted, which is the figure that says somebody is
 * falling behind - and a server disconnects a client whose pending bytes pass
 * its limit, so it is the number that predicts the disconnection rather than
 * reporting it afterwards.
 *
 * There is no channel column, because a NATS connection has no second layer
 * inside it. That is not a count that happens to be zero.
 */
export function ClientsNats() {
  const { t } = useTranslation();
  const state = useNatsClients();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const connections = useMemo(() => state.data ?? [], [state.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return connections;
    return connections.filter(
      (connection) =>
        peer(connection).toLowerCase().includes(needle) ||
        (clientName(connection) ?? "").toLowerCase().includes(needle) ||
        subjects(connection).some((subject) => subject.toLowerCase().includes(needle)),
    );
  }, [connections, search]);

  const panel = useMemo(
    () => connections.find((connection) => connectionKey(connection) === selected) ?? null,
    [connections, selected],
  );

  const close = useCallback(
    async (connection: ClientConnection) => {
      const ok = await confirm({
        title: t("board.clients.nats.closeTitle", {
          name: clientName(connection) ?? peer(connection),
        }),
        /* What actually happens: the client is disconnected, and most NATS
           libraries reconnect on their own within a second. Saying so is the
           difference between an operator expecting it to stay gone and one
           who knows to stop the application instead. */
        description: t("board.clients.nats.closeDescription", { server: serverOf(connection) }),
        confirmLabel: t("board.clients.nats.close"),
        danger: true,
      });
      if (!ok) return;
      try {
        await natsApi.closeConnection(connID, connectionKey(connection), "closed from mq-studio");
        toast.success(t("board.clients.nats.closed"));
        setSelected(null);
        await state.refresh();
      } catch (closeError) {
        toast.error(t("board.clients.nats.closeFailed"), {
          description: formatErrorMessage(closeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.clients.nats.title")}
        subtitle={t("board.clients.nats.subtitle")}
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
          className="w-[240px] flex-none"
          placeholder={t("board.clients.nats.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.clients.nats.found", { count: rows.length })}
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
                  {connections.length === 0
                    ? t("board.clients.nats.noClients")
                    : t("board.clients.nats.noMatches")}
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
                  <TableHead>{t("board.clients.nats.client")}</TableHead>
                  <TableHead>{t("board.clients.nats.server")}</TableHead>
                  <TableHead>{t("board.clients.nats.subjects")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.nats.in")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.nats.out")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.clients.nats.pending")}</TableHead>
                  <TableHead>{t("board.clients.nats.transport")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((connection) => (
                  <TableRow
                    key={connectionKey(connection)}
                    selected={selected === connectionKey(connection)}
                    onClick={() => setSelected(connectionKey(connection))}
                  >
                    <TableCell>
                      <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                        {clientName(connection) ?? peer(connection)}
                      </b>
                      {clientName(connection) != null && (
                        <span
                          className="mono3"
                          style={{ fontSize: "10.5px", color: "var(--c-muted)", marginLeft: "6px" }}
                        >
                          {peer(connection)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {serverOf(connection)}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      <SubjectSummary connection={connection} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={inMessages(connection)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={outMessages(connection)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Pending connection={connection} />
                    </TableCell>
                    <TableCell style={MONO11}>
                      <Status
                        tone={isEncrypted(connection) ? "ok" : "off"}
                        style={{ fontSize: "10px" }}
                      >
                        {transport(connection)}
                      </Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {panel != null && (
            <DetailPanel width={400} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={clientName(panel) ?? peer(panel)}
                badge={
                  <Status tone="off" style={{ fontSize: "10px" }}>
                    {kind(panel) ?? "client"}
                  </Status>
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <KV
                  rows={[
                    [t("board.clients.nats.peer"), mono(peer(panel))],
                    [t("board.clients.nats.server"), mono(serverOf(panel))],
                    [
                      t("board.clients.nats.clientId"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={clientId(panel)} />
                      </span>,
                    ],
                    [t("board.clients.nats.account"), mono(account(panel))],
                    [t("board.clients.nats.user"), mono(user(panel))],
                    [
                      t("board.clients.nats.library"),
                      <span className="mono3" style={MONO11}>
                        {/* Often the fastest way to work out which service a
                            connection belongs to, when it sent no name. */}
                        {language(panel) == null
                          ? "—"
                          : `${language(panel)} ${libraryVersion(panel) ?? ""}`}
                      </span>,
                    ],
                    [t("board.clients.nats.since"), mono(connectedAt(panel))],
                    [t("board.clients.nats.idle"), mono(idleFor(panel))],
                    [t("board.clients.nats.rtt"), mono(roundTrip(panel))],
                    [
                      t("board.clients.nats.bytes"),
                      <span className="mono3" style={MONO11}>
                        {formatBytes(receivedBytes(panel))} ↓ {formatBytes(sentBytes(panel))} ↑
                      </span>,
                    ],
                    [
                      t("board.clients.nats.encryption"),
                      <span className="mono3" style={MONO11}>
                        {isEncrypted(panel)
                          ? (cipher(panel) ?? t("board.clients.nats.encrypted"))
                          : t("board.clients.nats.plaintext")}
                      </span>,
                    ],
                  ]}
                />

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.clients.nats.subjects")}
                  </SectionLabel>
                  {subjects(panel).length === 0 ? (
                    <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {/* A publisher subscribes to nothing, which is a fact
                          about what it does rather than a missing field. */}
                      {t("board.clients.nats.publishesOnly")}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {subjects(panel).map((subject) => (
                        <Status key={subject} tone="off" style={{ fontSize: "10px" }}>
                          {subject}
                        </Status>
                      ))}
                    </div>
                  )}
                </div>
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button
                  variant="destructive"
                  /* Gated on where the row came from rather than attempted:
                     closing needs the system account, and the monitoring
                     endpoint is read-only by design. Per row rather than per
                     page, because that is the grain at which it is true. */
                  disabled={!canBeClosed(panel)}
                  onClick={() => void close(panel)}
                >
                  {t("board.clients.nats.close")}
                </Button>
                {!canBeClosed(panel) && (
                  <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
                    {t("board.clients.nats.cannotClose")}
                  </span>
                )}
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}

function mono(value: string | null) {
  return (
    <span className="mono3" style={MONO11}>
      {value ?? "—"}
    </span>
  );
}

function connectedAt(connection: ClientConnection): string | null {
  const at = connectedAtMs(connection);
  if (at <= 0) return null;
  return new Date(at).toLocaleString();
}

/** The subjects, truncated, with a publisher named rather than left blank. */
function SubjectSummary({ connection }: { connection: ClientConnection }) {
  const { t } = useTranslation();
  const all = subjects(connection);
  if (all.length === 0) {
    return (
      <span style={{ color: "var(--c-muted-2)" }}>{t("board.clients.nats.publishesOnlyShort")}</span>
    );
  }
  const shown = all.slice(0, 2);
  return (
    <>
      {shown.join(", ")}
      {all.length > shown.length && (
        <span style={{ color: "var(--c-muted)" }}>
          {" "}
          {t("board.clients.nats.moreSubjects", { count: all.length - shown.length })}
        </span>
      )}
    </>
  );
}

/**
 * What the server is holding to send this client.
 *
 * Marked only when there is any: a server disconnects a client whose pending
 * bytes pass its limit, so this is the figure that predicts the disconnection
 * - and a zero on every row would train the eye past the one that is not.
 */
function Pending({ connection }: { connection: ClientConnection }) {
  const bytes = pendingBytes(connection);
  if (bytes == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  if (bytes === 0) return <>0</>;
  return (
    <Status tone="warn" style={{ fontSize: "10px" }}>
      {formatBytes(bytes)}
    </Status>
  );
}
