import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Cable, Server, Turtle, Users } from "lucide-react";
import { Page, PageBody, PageHeader, RefreshButton } from "@/design/shell";
import { Bar, Panel, PanelHeader, StatTile, Status } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useNatsCluster } from "@/hooks/nats/useNatsCluster";
import * as natsApi from "@/api/nats";
import { formatBytes, formatCount } from "@/lib/format";
import { connections, metaLeader, slowConsumers, subscriptions } from "@/mq/nats/cluster";
import type { AccountUsage } from "@bindings/driver/nats/models";
import type { BrokerHealth, HealthCheck } from "@bindings/model/models";
import { KPI_GRID } from "./_shared";


/**
 * What this connection is looking at.
 *
 * Three sources, and the page keeps them visibly apart because each can be
 * absent on its own and each answers a different question. The account meters
 * come from JetStream and say what is stored. The server figures come from
 * whichever cluster tier answered and say what is connected. The health checks
 * are the server's own opinion of itself, which is not something this app can
 * work out from either.
 *
 * The meters are the reason this is not four tiles in a row. -1 is how the
 * server spells "no limit", and a bar drawn against -1 can never move - so
 * where there is no cap the figure is shown as a number and no bar is drawn at
 * all, rather than a bar that sits at zero forever and reads as an empty
 * account.
 */
export function OverviewNats() {
  const { t } = useTranslation();
  const cluster = useNatsCluster();
  const usage = useBrokerData(
    useCallback((connID: number) => natsApi.usage(connID), []),
  );
  const health = useBrokerData(
    useCallback((connID: number) => natsApi.health(connID), []),
  );

  const overview = cluster.data?.overview ?? null;
  const nodes = useMemo(() => cluster.data?.nodes ?? [], [cluster.data]);

  return (
    <Page>
      <PageHeader
        title={t("board.overview.nats.title")}
        subtitle={overview?.name ?? ""}
        actions={
          <RefreshButton
            refreshing={cluster.refreshing}
            online={cluster.online}
            onClick={() => {
              void cluster.refresh();
              void usage.refresh();
              void health.refresh();
            }}
          />
        }
      />
      <BoardState state={cluster}>
        <PageBody>
          <div className={KPI_GRID}>
            <StatTile
              label={t("board.overview.nats.servers")}
              icon={Server}
              tone="slate"
              value={String(nodes.length)}
              hint={
                overview != null && metaLeader(overview) != null
                  ? t("board.overview.nats.ledBy", { server: metaLeader(overview) })
                  : undefined
              }
            />
            <StatTile
              label={t("board.overview.nats.connections")}
              icon={Cable}
              tone="blue"
              value={reported(overview == null ? null : connections(overview))}
            />
            <StatTile
              label={t("board.overview.nats.subscriptions")}
              icon={Users}
              tone="teal"
              value={reported(overview == null ? null : subscriptions(overview))}
            />
            <StatTile
              label={t("board.overview.nats.slow")}
              icon={Turtle}
              tone="orange"
              value={reported(overview == null ? null : slowConsumers(overview))}
              hint={t("board.overview.nats.slowHint")}
            />
          </div>

          <div className="mqs-tablerow">
            <Panel>
              <PanelHeader title={t("board.overview.nats.storage")} />
              <div className="p-4">
                {usage.error != null ? (
                  /* JetStream can be absent while everything above still works,
                     so its failure belongs in its own panel rather than taking
                     the page down. */
                  <p className="text-xs text-muted-foreground">{usage.error}</p>
                ) : usage.data == null ? (
                  <p className="text-xs text-muted-foreground">{t("board.state.loading")}</p>
                ) : (
                  <Usage usage={usage.data} />
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title={t("board.overview.nats.health")} />
              <div className="p-4">
                {health.error != null ? (
                  <p className="text-xs text-muted-foreground">{health.error}</p>
                ) : (
                  <Health health={health.data} />
                )}
              </div>
            </Panel>
          </div>
        </PageBody>
      </BoardState>
    </Page>
  );
}

/** A figure the cluster did not report reads as a dash. */
function reported(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * What the account is using, against what it may use.
 *
 * A bar only where there is a limit to draw one against. The server spells "no
 * cap" as -1, and a meter with no ceiling would either sit at zero forever or
 * have to invent one - both of which say something false about how full the
 * account is.
 */
function Usage({ usage }: { usage: AccountUsage }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <Gauge
        label={t("board.overview.nats.onDisk")}
        used={usage.storeUsed}
        limit={usage.storeLimit}
        format={formatBytes}
      />
      <Gauge
        label={t("board.overview.nats.inMemory")}
        used={usage.memoryUsed}
        limit={usage.memoryLimit}
        format={formatBytes}
      />
      <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--c-muted)" }}>
        <span>
          {t("board.overview.nats.streams")}{" "}
          <b className="text-(--c-fg-2) tabular-nums">{formatCount(usage.streams)}</b>
          {usage.streamLimit > 0 && ` / ${formatCount(usage.streamLimit)}`}
        </span>
        <span>
          {t("board.overview.nats.consumers")}{" "}
          <b className="text-(--c-fg-2) tabular-nums">{formatCount(usage.consumers)}</b>
          {usage.consumerLimit > 0 && ` / ${formatCount(usage.consumerLimit)}`}
        </span>
        {usage.domain !== "" && (
          <span>
            {t("board.overview.nats.domain")} <b className="mono3">{usage.domain}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function Gauge({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  format: (value: number) => string;
}) {
  const { t } = useTranslation();
  const capped = limit > 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "11px",
          marginBottom: "3px",
        }}
      >
        <span style={{ color: "var(--c-muted)" }}>{label}</span>
        <span className="text-(--c-fg-2) tabular-nums">
          {format(used)}
          {capped ? (
            ` / ${format(limit)}`
          ) : (
            <span style={{ color: "var(--c-muted-2)" }}>
              {" "}
              · {t("board.overview.nats.noLimit")}
            </span>
          )}
        </span>
      </div>
      {capped && <Bar value={Math.min(100, Math.round((used / limit) * 100))} />}
    </div>
  );
}

/**
 * The server's own checks.
 *
 * Three states rather than two, and the third is the one that matters: a check
 * the endpoint could not be reached for is not a check that failed, and
 * drawing it red would send somebody looking for a problem with their cluster
 * instead of with their connection.
 */
function Health({ health }: { health: BrokerHealth | null }) {
  const { t } = useTranslation();
  const checks = (health?.checks ?? []).filter((check): check is HealthCheck => check != null);
  if (checks.length === 0) {
    return (
      <div style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
        {t("board.state.loading")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {checks.map((check) => (
        <div key={check.id} style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
          <Status
            tone={check.unavailable ? "off" : check.passed ? "ok" : "err"}
            style={{ fontSize: "10px" }}
          >
            {check.unavailable
              ? t("board.overview.nats.checkUnavailable")
              : check.passed
                ? t("board.overview.nats.checkPassed")
                : t("board.overview.nats.checkFailed")}
          </Status>
          <span style={{ fontSize: "11.5px" }}>
            {t(`board.overview.nats.check.${check.id}`)}
          </span>
          {check.reason !== "" && (
            <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>{check.reason}</span>
          )}
        </div>
      ))}
    </div>
  );
}
