import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
  Bar,
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  KV,
  SectionLabel,
  Status,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useNatsAccounts } from "@/hooks/nats/useNatsAccounts";
import { formatBytes, formatCount } from "@/lib/format";
import {
  apiErrors,
  apiRequests,
  bytesIn,
  bytesOut,
  connections,
  hasJetStream,
  isSystemAccount,
  leafNodes,
  memoryLimit,
  memoryUsed,
  messagesIn,
  messagesOut,
  readVia,
  serversReporting,
  slowConsumers,
  storageLimit,
  storageUsed,
  subscriptions,
  usedPercent,
} from "@/mq/nats/accounts";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

function Metric({ value, format }: { value: number | null; format?: (value: number) => string }) {
  if (value == null) return <span style={{ color: "var(--c-muted-2)" }}>—</span>;
  return <>{format ? format(value) : formatCount(value)}</>;
}

/**
 * The accounts on the cluster.
 *
 * An account is NATS's isolation boundary and its only one: two accounts on
 * the same server share no subjects, no streams and no limits, and every
 * connection belongs to exactly one. That is what makes this a page rather
 * than a filter - the same reason RabbitMQ's vhosts are one.
 *
 * Read-only, and that is NATS rather than this board stopping short. No server
 * has a request that creates an account: in configuration mode it is a block
 * in the server's file that appears on reload, and in operator mode a JWT that
 * nsc signs and pushes. So there is no button here, and a line at the top says
 * where accounts do come from instead - a disabled control the user could
 * never enable would only invite the question again.
 *
 * The JetStream columns are the reason to open it. They say which account is
 * eating the disk, and against what cap, which is the one question a shared
 * cluster produces that the streams page cannot answer.
 */
export function AccountsNats() {
  const { t } = useTranslation();
  const state = useNatsAccounts();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const accounts = useMemo(() => state.data ?? [], [state.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return accounts;
    return accounts.filter((account) => account.name.toLowerCase().includes(needle));
  }, [accounts, search]);

  const panel = useMemo(
    () => accounts.find((account) => account.name === selected) ?? null,
    [accounts, selected],
  );

  /* One server answered when the connection has only the monitoring endpoint,
     whatever the size of the cluster - so the counts are that server's share
     rather than the cluster's. Said once above the table rather than on every
     row, because it is a property of the connection. */
  const partial = accounts.length > 0 && (serversReporting(accounts[0]!) ?? 0) <= 1;

  return (
    <Page>
      <PageHeader
        title={t("board.vhosts.nats.title")}
        subtitle={t("board.vhosts.nats.subtitle")}
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
          placeholder={t("board.vhosts.nats.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.vhosts.nats.found", { count: rows.length })}
        </span>
      </Toolbar>

      <BoardState state={state}>
        <ListArea>
          <ListPane>
            <div
              style={{
                padding: "8px 12px",
                fontSize: "11px",
                color: "var(--c-muted)",
                borderBottom: "1px solid var(--c-line)",
              }}
            >
              {/* Where accounts come from, said plainly. Without it a
                  read-only page reads as a page missing its buttons. */}
              {t("board.vhosts.nats.readOnly")}
              {partial && ` ${t("board.vhosts.nats.oneServer")}`}
            </div>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.vhosts.nats.account")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.vhosts.nats.connections")}</TableHead>
                  <TableHead style={RIGHT}>{t("board.vhosts.nats.subscriptions")}</TableHead>
                  <TableHead>{t("board.vhosts.nats.jetstream")}</TableHead>
                  <TableHead style={{ width: "160px" }}>
                    {t("board.vhosts.nats.storage")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((account) => (
                  <TableRow
                    key={account.name}
                    selected={selected === account.name}
                    onClick={() => setSelected(account.name)}
                  >
                    <TableCell>
                      <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                        {account.name}
                      </b>
                      {isSystemAccount(account) && (
                        <Status tone="ok" style={{ fontSize: "10px", marginLeft: "6px" }}>
                          {t("board.vhosts.nats.systemAccount")}
                        </Status>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={connections(account)} />
                    </TableCell>
                    <TableCell className="mono3" style={RIGHT}>
                      <Metric value={subscriptions(account)} />
                    </TableCell>
                    <TableCell style={MONO11}>
                      {hasJetStream(account) ? (
                        <Status tone="ok" style={{ fontSize: "10px" }}>
                          {t("board.vhosts.nats.enabled")}
                        </Status>
                      ) : (
                        <span style={{ color: "var(--c-muted-2)" }}>
                          {t("board.vhosts.nats.notEnabled")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Usage
                        used={storageUsed(account)}
                        cap={storageLimit(account)}
                        enabled={hasJetStream(account)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {panel != null && (
            <DetailPanel width={380} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={panel.name}
                badge={
                  isSystemAccount(panel) ? (
                    <Status tone="ok" style={{ fontSize: "10px" }}>
                      {t("board.vhosts.nats.systemAccount")}
                    </Status>
                  ) : undefined
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <KV
                  rows={[
                    [
                      t("board.vhosts.nats.connections"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={connections(panel)} />
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.leafNodes"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={leafNodes(panel)} />
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.subscriptions"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={subscriptions(panel)} />
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.slowConsumers"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={slowConsumers(panel)} />
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.messages"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={messagesIn(panel)} /> ↓ <Metric value={messagesOut(panel)} />{" "}
                        ↑
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.bytes"),
                      <span className="mono3" style={MONO11}>
                        <Metric value={bytesIn(panel)} format={formatBytes} /> ↓{" "}
                        <Metric value={bytesOut(panel)} format={formatBytes} /> ↑
                      </span>,
                    ],
                    [
                      t("board.vhosts.nats.readVia"),
                      <span className="mono3" style={MONO11}>
                        {readVia(panel) === "system"
                          ? t("board.vhosts.nats.viaSystem", { count: serversReporting(panel) ?? 1 })
                          : t("board.vhosts.nats.viaMonitor")}
                      </span>,
                    ],
                  ]}
                />

                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.vhosts.nats.jetstream")}
                  </SectionLabel>
                  {!hasJetStream(panel) ? (
                    <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                      {/* A fact about the account rather than a figure that
                          failed to load: the server lists the accounts that
                          have JetStream, and this one is not among them. */}
                      {t("board.vhosts.nats.noJetStream")}
                    </div>
                  ) : (
                    <KV
                      rows={[
                        [
                          t("board.vhosts.nats.storage"),
                          <Usage
                            used={storageUsed(panel)}
                            cap={storageLimit(panel)}
                            enabled
                            key="storage"
                          />,
                        ],
                        [
                          t("board.vhosts.nats.memory"),
                          <Usage
                            used={memoryUsed(panel)}
                            cap={memoryLimit(panel)}
                            enabled
                            key="memory"
                          />,
                        ],
                        [
                          t("board.vhosts.nats.apiRequests"),
                          <span className="mono3" style={MONO11}>
                            <Metric value={apiRequests(panel)} />
                            {(apiErrors(panel) ?? 0) > 0 && (
                              <span style={{ color: "var(--c-warn)", marginLeft: "6px" }}>
                                {t("board.vhosts.nats.apiErrors", { count: apiErrors(panel) ?? 0 })}
                              </span>
                            )}
                          </span>,
                        ],
                      ]}
                    />
                  )}
                </div>
              </DetailPanelBody>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}

/**
 * What the account is storing, against its cap where it has one.
 *
 * An uncapped account gets the figure on its own rather than an empty bar: a
 * meter with nothing behind it can never move, and drawing one would say the
 * account has plenty of room left when nothing has been measured at all.
 */
function Usage({
  used,
  cap,
  enabled,
}: {
  used: number | null;
  cap: number | null;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  if (!enabled || used == null) {
    return <span style={{ color: "var(--c-muted-2)", fontSize: "11px" }}>—</span>;
  }
  const percent = usedPercent(used, cap);
  if (percent == null) {
    return (
      <span className="mono3" style={MONO11}>
        {formatBytes(used)}{" "}
        <span style={{ color: "var(--c-muted)" }}>{t("board.vhosts.nats.uncapped")}</span>
      </span>
    );
  }
  return (
    <div>
      <div className="mono3" style={{ ...MONO11, marginBottom: "3px" }}>
        {formatBytes(used)} / {formatBytes(cap ?? 0)}
      </div>
      <Bar value={percent} color={percent >= 90 ? "var(--c-bad)" : "var(--c-ok)"} />
    </div>
  );
}
