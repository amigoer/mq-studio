import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OutlineTag, Panel, SelectField, Status, WarnBanner } from "@/components";
import { Page, PageBody, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { usePulsarNamespaces } from "@/hooks/pulsar/usePulsarNamespaces";
import { usePulsarDeadLetters } from "@/hooks/pulsar/usePulsarDeadLetters";
import {
  DeadLetterKind,
  isOrphaned,
  kindOf,
  reported,
  sourceSubscription,
  sourceTopic,
} from "@/mq/pulsar/deadletter";
import { formatCount } from "@/lib/format";

const R = { textAlign: "right" } as const;

/** A figure the driver did not report, drawn as absent rather than as zero. */
function shown(value: number | null): string {
  return value == null ? "—" : formatCount(value);
}

/**
 * Board 16c — Pulsar dead letters.
 *
 * There is no broker-side dead-letter object on this family, and the page says
 * so by what it shows. A consumer configured with a DLQ policy republishes to
 * "<topic>-<subscription>-DLQ"; nothing on the cluster records that link, so
 * these rows are ordinary topics recognised by their names.
 *
 * Two things follow, and both are the point of the page. The subscription is a
 * column rather than a detail, because one topic read by five subscriptions
 * has five separate dead-letter topics and only the subscription says which
 * reader gave up. And a row can have no source at all - its origin topic was
 * deleted - which means a backlog nothing will ever drain and nobody will ever
 * look at. That is the row worth finding, so it is drawn as a finding rather
 * than as a row with blank columns.
 */
export function DlqPulsar() {
  const { t } = useTranslation();

  const namespaces = usePulsarNamespaces();
  const [namespace, setNamespace] = useState("");
  const scope = namespace || (namespaces.data?.[0]?.name ?? "");
  const state = usePulsarDeadLetters(scope);

  const queues = state.data ?? [];
  const orphans = queues.filter(isOrphaned).length;

  return (
    <Page>
      <PageHeader
        title={t("board.dlq.pulsar.title")}
        subtitle={scope}
        actions={
          <RefreshButton
            refreshing={state.refreshing}
            online={state.online}
            onClick={() => void state.refresh()}
          />
        }
      />
      <Toolbar>
        <SelectField
          value={scope}
          options={(namespaces.data ?? []).map((entry) => ({
            value: entry.name,
            label: entry.name,
          }))}
          onValueChange={setNamespace}
        />
        <span className="text-xs text-muted-foreground">
          {t("board.dlq.pulsar.conventionNote")}
        </span>
      </Toolbar>
      <BoardState
        state={state}
        empty={
          <PageBody>
            <p className="text-xs text-muted-foreground">{t("board.dlq.pulsar.none")}</p>
          </PageBody>
        }
      >
        <PageBody>
          {orphans > 0 && (
            <WarnBanner>{t("board.dlq.pulsar.orphanBanner", { count: orphans })}</WarnBanner>
          )}
          <Panel>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.dlq.pulsar.topic")}</TableHead>
                  <TableHead>{t("board.dlq.pulsar.kind")}</TableHead>
                  <TableHead>{t("board.dlq.pulsar.source")}</TableHead>
                  <TableHead>{t("board.dlq.pulsar.subscription")}</TableHead>
                  <TableHead style={R}>{t("board.dlq.pulsar.depth")}</TableHead>
                  <TableHead style={R}>{t("board.dlq.pulsar.consumers")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map((queue) => (
                  <TableRow key={queue.name}>
                    <TableCell className="mono3">{queue.name}</TableCell>
                    <TableCell>
                      {/* A retry topic is a pipeline; a DLQ is where it ends
                          up. A growing retry means consumers are failing and
                          recovering, a growing DLQ means they gave up. */}
                      <OutlineTag>
                        {kindOf(queue) === DeadLetterKind.Retry ? "RETRY" : "DLQ"}
                      </OutlineTag>
                    </TableCell>
                    <TableCell className="mono3">
                      {isOrphaned(queue) ? (
                        <Status tone="warn">{t("board.dlq.pulsar.orphan")}</Status>
                      ) : (
                        sourceTopic(queue)
                      )}
                    </TableCell>
                    <TableCell className="mono3">{sourceSubscription(queue) || "—"}</TableCell>
                    <TableCell style={R}>{shown(reported(Number(queue.depth)))}</TableCell>
                    <TableCell style={R}>{shown(reported(queue.consumers))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </PageBody>
      </BoardState>
    </Page>
  );
}
