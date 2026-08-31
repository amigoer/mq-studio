import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import {
  KV,
  Panel,
  PanelHeader,
  Segmented,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRabbitReplication } from "@/hooks/rabbitmq/useRabbitReplication";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import { formatMessageTime } from "@/lib/time";
import { useSettings } from "@/hooks/useSettings";
import * as rabbitApi from "@/api/rabbitmq";
import type { FederationUpstream, Shovel } from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

type Tab = "shovels" | "federation";

/**
 * Shovels and federation - the two ways messages move between brokers.
 *
 * One page because they answer the same question from two directions: what is
 * this broker exchanging with another, and is it working. They do it
 * differently, and the page keeps that straight - a shovel moves messages from
 * somewhere to somewhere, and federation keeps two brokers' exchanges or
 * queues in step continuously.
 *
 * Read and delete rather than create. Both are defined by a URI carrying
 * another broker's credentials, and a form collecting one would be storing a
 * password this app cannot verify - they are declared where the rest of a
 * deployment is. What the page adds is the half nothing else shows: whether
 * the thing is actually running, and why not.
 */
export function ReplicationRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitReplication();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("shovels");

  const shovels = useMemo(() => state.data?.shovels ?? [], [state.data]);
  const upstreams = useMemo(() => state.data?.upstreams ?? [], [state.data]);

  const removeShovel = useCallback(
    async (shovel: Shovel) => {
      const ok = await confirm({
        title: t("board.replication.rabbitmq.deleteShovelTitle", { name: shovel.name }),
        description: t("board.replication.rabbitmq.deleteShovelDesc"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteShovel(connID, shovel.namespace, shovel.name);
        toast.success(t("board.replication.rabbitmq.shovelDeleted", { name: shovel.name }));
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.replication.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const removeUpstream = useCallback(
    async (upstream: FederationUpstream) => {
      const ok = await confirm({
        title: t("board.replication.rabbitmq.deleteUpstreamTitle", { name: upstream.name }),
        description: t("board.replication.rabbitmq.deleteUpstreamDesc"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteFederationUpstream(connID, upstream.namespace, upstream.name);
        toast.success(t("board.replication.rabbitmq.upstreamDeleted", { name: upstream.name }));
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.replication.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.replication.rabbitmq.title")}
        subtitle={t("board.replication.rabbitmq.subtitle")}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={state.refresh}
          />
        }
      />
      <PageBody>
        <BoardState state={state}>
          <Segmented
            value={tab}
            onChange={(next: Tab) => setTab(next)}
            options={[
              {
                value: "shovels",
                label: t("board.replication.rabbitmq.tabShovels", { count: shovels.length }),
              },
              {
                value: "federation",
                label: t("board.replication.rabbitmq.tabFederation", {
                  count: upstreams.length,
                }),
              },
            ]}
          />

          {tab === "shovels" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.replication.rabbitmq.shovelHint")}
              </span>
              {shovels.map((shovel) => (
                <ShovelCard
                  key={`${shovel.namespace}/${shovel.name}`}
                  shovel={shovel}
                  onDelete={() => void removeShovel(shovel)}
                />
              ))}
              {shovels.length === 0 && (
                <Panel style={{ padding: "12px 16px", fontSize: "11.5px", color: "var(--c-muted)" }}>
                  {t("board.replication.rabbitmq.noShovels")}
                </Panel>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.replication.rabbitmq.federationHint")}
              </span>
              {upstreams.map((upstream) => (
                <UpstreamCard
                  key={`${upstream.namespace}/${upstream.name}`}
                  upstream={upstream}
                  onDelete={() => void removeUpstream(upstream)}
                />
              ))}
              {upstreams.length === 0 && (
                <Panel style={{ padding: "12px 16px", fontSize: "11.5px", color: "var(--c-muted)" }}>
                  {t("board.replication.rabbitmq.noUpstreams")}
                </Panel>
              )}
            </div>
          )}
        </BoardState>
      </PageBody>
    </Page>
  );
}

function ShovelCard({ shovel, onDelete }: { shovel: Shovel; onDelete: () => void }) {
  const { t } = useTranslation();
  // The broker reports this in UTC; the driver re-emits it with its zone so it
  // can be shown in the reader's, like every other timestamp in the app.
  const { settings } = useSettings();
  /* A static shovel comes from the broker's configuration file and cannot be
     deleted through the API - offering the button would be offering a failure. */
  const isStatic = shovel.type === "static";

  return (
    <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <PanelHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span>{shovel.name}</span>
            <span className="mono3" style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
              {shovel.namespace}
            </span>
            <ShovelState state={shovel.state} />
            {isStatic && (
              <Status tone="off" style={TAG}>
                static
              </Status>
            )}
          </span>
        }
        action={
          !isStatic && (
            <button type="button" className="mqs-linkbtn" onClick={onDelete}>
              {t("board.common.delete")}
            </button>
          )
        }
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px" }}>
        <span className="mono3" style={MONO11}>
          {shovel.source || "-"}
        </span>
        <ArrowRight size={12} aria-hidden style={{ color: "var(--c-muted-2)" }} />
        <span className="mono3" style={MONO11}>
          {shovel.target || "-"}
        </span>
      </div>
      <KV
        rows={[
          [
            t("board.replication.rabbitmq.from"),
            <Uris key="src" uris={shovel.sourceUri} />,
          ],
          [
            t("board.replication.rabbitmq.to"),
            <Uris key="dst" uris={shovel.targetUri} />,
          ],
          [t("board.replication.rabbitmq.ackMode"), shovel.ackMode || "-"],
          ...(shovel.since !== ""
            ? ([
                [
                  t("board.replication.rabbitmq.since"),
                  formatMessageTime(shovel.since, settings.timezone),
                ],
              ] as const)
            : []),
        ]}
      />
    </Panel>
  );
}

/**
 * A shovel's state, with the empty case named.
 *
 * A defined shovel that reports no state has not started, which is a different
 * problem from one that started and failed - and a blank cell would leave both
 * looking the same.
 */
function ShovelState({ state }: { state: string }) {
  const { t } = useTranslation();
  if (state === "") return <Status tone="warn">{t("board.replication.rabbitmq.notStarted")}</Status>;
  if (state === "running") return <Status tone="ok">{state}</Status>;
  if (state === "starting") return <Status tone="warn">{state}</Status>;
  return <Status tone="err">{state}</Status>;
}

function UpstreamCard({
  upstream,
  onDelete,
}: {
  upstream: FederationUpstream;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Panel style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <PanelHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span>{upstream.name}</span>
            <span className="mono3" style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
              {upstream.namespace}
            </span>
            <LinkState state={upstream.state} />
          </span>
        }
        action={
          <button type="button" className="mqs-linkbtn" onClick={onDelete}>
            {t("board.common.delete")}
          </button>
        }
      />
      {/* An upstream is configuration; the link is the connection. When the
          link is down the broker says why, and that sentence is the whole
          value of this page. */}
      {upstream.error !== "" && (
        <div style={{ fontSize: "11.5px", color: "var(--c-err-text)" }}>{upstream.error}</div>
      )}
      <KV
        rows={[
          [t("board.replication.rabbitmq.upstream"), <Uris key="uri" uris={upstream.uri} />],
          [
            t("board.replication.rabbitmq.federates"),
            upstream.exchange !== ""
              ? `exchange ${upstream.exchange}`
              : upstream.queue !== ""
                ? `queue ${upstream.queue}`
                : t("board.replication.rabbitmq.everything"),
          ],
          ...(upstream.maxHops > 0
            ? ([[t("board.replication.rabbitmq.maxHops"), String(upstream.maxHops)]] as const)
            : []),
          [t("board.replication.rabbitmq.ackMode"), upstream.ackMode || "-"],
        ]}
      />
    </Panel>
  );
}

function LinkState({ state }: { state: string }) {
  const { t } = useTranslation();
  if (state === "") {
    return <Status tone="warn">{t("board.replication.rabbitmq.noLink")}</Status>;
  }
  return <Status tone={state === "running" ? "ok" : "err"}>{state}</Status>;
}

/**
 * The addresses, with their passwords already gone.
 *
 * The driver removes them before they leave the process: a shovel URI is the
 * one place the management API stores another broker's credential in plain
 * text and hands it back on request, and this page is exactly the sort of
 * thing that ends up in a screenshot.
 */
function Uris({ uris }: { uris: string[] }) {
  const { t } = useTranslation();
  if (uris.length === 0) return <span>-</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "2px" }}>
      {uris.map((uri) => (
        <span key={uri} className="mono3" style={MONO11} title={t("board.replication.rabbitmq.redacted")}>
          {uri}
        </span>
      ))}
    </span>
  );
}
