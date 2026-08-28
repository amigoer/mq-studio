import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { PageBody } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { RefreshButton } from "@/components/RefreshButton";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Binding, Destination } from "@/api/models";
import * as routingApi from "@/api/routing";
import { useConnections } from "@/hooks/useConnections";
import { formatErrorMessage } from "@/lib/utils";
import { exchangeType, durable } from "./destinations";

/**
 * Exchanges and bindings.
 *
 * This is the one whole-page override in the design, and it is here because
 * the override rule allows it rather than despite it: routing has no
 * counterpart in any other family, so there is no canonical page to
 * contribute columns to.
 */
export function RoutingPage() {
  const { t } = useTranslation();
  const { active, activeKey } = useConnections();
  const [exchanges, setExchanges] = useState<Destination[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextExchanges, nextBindings] = await Promise.all([
        routingApi.getExchanges(),
        routingApi.getBindings(),
      ]);
      setExchanges(nextExchanges);
      setBindings(nextBindings);
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, activeKey]);

  return (
    <PageBody>
      <PageHeader
        title={t("mq.rabbitmq.routing.title")}
        subtitle={active?.name ?? ""}
      >
        <RefreshButton onClick={load} />
      </PageHeader>

      {error ? <EmptyState title={error} /> : null}

      <Card className="mb-4">
        <div className="px-4 py-3 text-fs-13 font-medium">
          {t("mq.rabbitmq.routing.exchanges")}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("mq.rabbitmq.routing.source")}</TableHead>
              <TableHead>{t("mq.rabbitmq.routing.exchangeType")}</TableHead>
              <TableHead>{t("mq.rabbitmq.routing.durable")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {exchanges.map((exchange) => (
              <TableRow key={`${exchange.ref.namespace}/${exchange.ref.name}`}>
                <TableCell className="font-mono-design">
                  {exchange.ref.name || "(default)"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{exchangeType(exchange)}</Badge>
                </TableCell>
                <TableCell>{durable(exchange) ? "✓" : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="px-4 py-3 text-fs-13 font-medium">
          {t("mq.rabbitmq.routing.bindings")}
        </div>
        {!loading && bindings.length === 0 ? (
          <div className="text-muted-foreground px-4 pb-4 text-fs-12">
            {t("mq.rabbitmq.routing.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("mq.rabbitmq.routing.source")}</TableHead>
                <TableHead>{t("mq.rabbitmq.routing.destination")}</TableHead>
                <TableHead>
                  {t("mq.rabbitmq.routing.destinationKind")}
                </TableHead>
                <TableHead>{t("mq.rabbitmq.routing.routingKey")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((binding) => (
                <TableRow key={binding.id}>
                  <TableCell className="font-mono-design">
                    {binding.source || "(default)"}
                  </TableCell>
                  <TableCell className="font-mono-design">
                    {binding.destination}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{binding.destinationKind}</Badge>
                  </TableCell>
                  <TableCell className="font-mono-design">
                    {binding.routingKey || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}
