import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  KV,
  Panel,
  ProtoBadge,
  SectionLabel,
  Status,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useRabbitRouting } from "@/hooks/rabbitmq/useRabbitRouting";
import { formatCount, formatRate } from "@/lib/format";
import {
  alternateExchange,
  argumentsOf,
  exchangeLabel,
  exchangeTags,
  exchangeType,
  internal,
} from "@/mq/rabbitmq/destinations";
import { bindingKey, bindingsBySource, bindsExchange, routesOnKey } from "@/mq/rabbitmq/routing";
import type { Binding, Destination } from "@/api/models";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** The exchanges RabbitMQ creates for itself on every virtual host. */
const isBuiltIn = (name: string) => name === "" || name.startsWith("amq.");

/**
 * Board 4b - RabbitMQ exchanges and bindings.
 *
 * This is the page with no counterpart in any other family, which is what
 * earns it a nav entry of its own: RocketMQ and Kafka publish straight to a
 * destination, and there is nothing between the producer and the queue to
 * draw.
 *
 * Two rates rather than one. In is what was published to the exchange, out is
 * what it managed to route onward, and the gap between them is messages that
 * matched no binding - the thing worth knowing when a topology is wrong.
 *
 * The canvas drew "new exchange", "add binding", "unbind" and a publish test.
 * They arrive with the write operations; until then the page reads.
 */
export function ExchangesRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitRouting();
  const [search, setSearch] = useState("");
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const exchanges = useMemo(() => state.data?.exchanges ?? [], [state.data]);
  const bindings = useMemo(() => state.data?.bindings ?? [], [state.data]);

  /* One pass rather than a filter per row: a virtual host with a few hundred
     bindings would otherwise walk the whole list once for every exchange. */
  const bySource = useMemo(() => bindingsBySource(bindings), [bindings]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return exchanges
      .filter((exchange) => {
        if (!showBuiltIn && isBuiltIn(exchange.ref.name)) return false;
        return needle === "" || exchangeLabel(exchange).toLowerCase().includes(needle);
      })
      .sort((left, right) => exchangeLabel(left).localeCompare(exchangeLabel(right)));
  }, [exchanges, search, showBuiltIn]);

  const detail = useMemo(
    () => rows.find((exchange) => exchange.ref.name === selected) ?? null,
    [rows, selected],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.common.exchange")}
        subtitle={t("board.topics.rabbitmq.exchangeSubtitle", {
          exchanges: exchanges.length,
          bindings: bindings.length,
        })}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={state.refresh}
          />
        }
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Input
            className="w-[220px] flex-none"
            placeholder={t("board.topics.rabbitmq.searchExchange")}
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
            <Switch checked={showBuiltIn} onCheckedChange={setShowBuiltIn} />
            {t("board.topics.rabbitmq.showAmq")}
          </span>
          <span className="flex-1" />
          <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
            {t("board.topics.rabbitmq.shown", { shown: rows.length, total: exchanges.length })}
          </span>
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={exchanges.length === 0 ? t("board.topics.rabbitmq.noExchanges") : undefined}
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.exchange")}</TableHead>
                  <TableHead>{t("board.common.type")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.common.bindings")}
                  </TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.topics.rabbitmq.inOutRate")}
                  </TableHead>
                  <TableHead>{t("board.common.features")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((exchange) => {
                  const outgoing = bySource.get(exchange.ref.name) ?? [];
                  return (
                    <TableRow
                      key={exchange.ref.name}
                      selected={selected === exchange.ref.name}
                      onClick={() => setSelected(exchange.ref.name)}
                    >
                      <TableCell>
                        <b
                          style={{
                            fontWeight: 500,
                            color: exchange.ref.name === "" ? "var(--c-muted)" : undefined,
                          }}
                        >
                          {exchangeLabel(exchange)}
                        </b>
                      </TableCell>
                      <TableCell>{exchangeType(exchange)}</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {/* Every queue is bound to the default exchange by its
                            own name, and those bindings are implicit - the
                            broker lists none of them. */}
                        {exchange.ref.name === "" ? "-" : formatCount(outgoing.length)}
                      </TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {formatRate(exchange.rateIn)} / {formatRate(exchange.rateOut)}
                      </TableCell>
                      <TableCell>
                        {exchangeTags(exchange).map((tag) => (
                          <Status key={tag} tone="off" style={TAG}>
                            {tag}
                          </Status>
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && exchanges.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={5} style={{ color: "var(--c-muted)" }}>
                      {t("board.topics.rabbitmq.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={390} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={exchangeLabel(detail)}
              badge={<ProtoBadge protocol="rabbitmq" label={exchangeType(detail)} />}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <ExchangeDetail
                exchange={detail}
                outgoing={bySource.get(detail.ref.name) ?? []}
              />
            </DetailPanelBody>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

function ExchangeDetail({ exchange, outgoing }: { exchange: Destination; outgoing: Binding[] }) {
  const { t } = useTranslation();
  const alternate = alternateExchange(exchange);
  const args = argumentsOf(exchange);

  return (
    <>
      <KV
        rows={[
          [t("board.common.type"), exchangeType(exchange)],
          [
            t("board.common.persistence"),
            exchange.attributes?.durable === "true" ? "durable" : "transient",
          ],
          [
            t("board.topics.rabbitmq.internal"),
            internal(exchange)
              ? t("board.topics.rabbitmq.internalYes")
              : t("board.topics.rabbitmq.internalNo"),
          ],
          ...(alternate !== ""
            ? ([
                [
                  t("board.topics.rabbitmq.alternateExchange"),
                  <span key="ae" className="mono3" style={MONO11}>
                    {alternate}
                  </span>,
                ],
              ] as const)
            : []),
        ]}
      />

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.topics.rabbitmq.bindingsCount", { count: outgoing.length })}
        </SectionLabel>
        <Panel
          style={{
            padding: "9px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "11.5px",
          }}
        >
          {exchange.ref.name === "" && (
            <span style={{ color: "var(--c-muted)" }}>
              {t("board.topics.rabbitmq.defaultExchangeNote")}
            </span>
          )}
          {outgoing.map((binding) => (
            <BindingRow key={bindingKey(binding)} binding={binding} />
          ))}
          {outgoing.length === 0 && exchange.ref.name !== "" && (
            <span style={{ color: "var(--c-muted)" }}>
              {t("board.topics.rabbitmq.noBindings")}
            </span>
          )}
        </Panel>
      </div>

      {Object.keys(args).length > 0 && (
        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>
            {t("board.topics.rabbitmq.arguments")}
          </SectionLabel>
          <KV
            rows={Object.entries(args).map(([key, value]) => [
              key,
              <span key={key} className="mono3" style={MONO11}>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>,
            ])}
          />
        </div>
      )}
    </>
  );
}

function BindingRow({ binding }: { binding: Binding }) {
  const { t } = useTranslation();
  const args = Object.entries(binding.arguments ?? {});
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
      <ProtoBadge
        protocol="rabbitmq"
        label={bindsExchange(binding) ? "ex" : "q"}
        style={{ fontSize: "9px" }}
      />
      <ArrowRight size={12} style={{ color: "var(--c-muted-2)", flex: "none" }} aria-hidden />
      <span className="mono3" style={MONO11}>
        {binding.destination}
      </span>
      {/* A fanout binds with no routing key and a headers exchange matches on
          arguments instead, so an empty key is the answer rather than a gap. */}
      <span className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
        {routesOnKey(binding)
          ? `rk = ${binding.routingKey}`
          : t("board.topics.rabbitmq.noRoutingKey")}
      </span>
      {args.map(([key, value]) => (
        <Status key={key} tone="off" style={TAG}>
          {key} = {value}
        </Status>
      ))}
    </div>
  );
}
