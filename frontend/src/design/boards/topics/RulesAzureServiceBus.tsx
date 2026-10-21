import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  ListArea,
  ListPane,
  Page,
  PageHeader,
  RefreshButton,
  StatusBar,
  Toolbar,
} from "@/design/shell";
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
  OutlineTag,
  SectionLabel,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useServiceBusRouting } from "@/hooks/azureservicebus/useServiceBusRouting";
import {
  DEFAULT_RULE,
  matchesEverything,
  matchesNothing,
  rule as readRule,
  type ServiceBusRule,
} from "@/mq/azureservicebus/rules";
import { entity as readEntity } from "@/mq/azureservicebus/entities";
import { cn, formatErrorMessage } from "@/lib/utils";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as serviceBusApi from "@/api/azureservicebus";
import { RuleDialogAzureServiceBus } from "./RuleDialogAzureServiceBus";

const DASH = "—";

/**
 * Azure Service Bus rules.
 *
 * The routing page, and this family earns one where the two hosted families
 * before it did not. Their filtering is a field on the reader: a Pub/Sub
 * subscription carries a filter string set once at creation, an SQS queue
 * carries nothing at all. A Service Bus subscription carries rules - objects
 * with names, several to a subscription, each a filter and optionally an
 * action that rewrites the message on the way in - so which messages reach
 * which subscription is a topology, and it belongs beside RabbitMQ's exchanges
 * and bindings rather than on a form.
 *
 * Two states this page exists to make visible, and neither shows anywhere
 * else. A subscription whose rules have all been deleted receives nothing
 * while reporting itself Active with an empty backlog. And a rule with a false
 * filter is legal, matches nothing, and looks exactly like one that works.
 */
export function RulesAzureServiceBus() {
  const { t } = useTranslation();
  const state = useServiceBusRouting();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const rules = useMemo(() => (state.data?.rules ?? []).map(readRule), [state.data]);
  const topics = useMemo(
    () => (state.data?.topics ?? []).map(readEntity),
    [state.data],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rules.filter(
      (row) =>
        needle === "" ||
        row.topic.toLowerCase().includes(needle) ||
        row.subscription.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle),
    );
  }, [rules, search]);

  const key = (row: ServiceBusRule) => `${row.topic}/${row.subscription}/${row.name}`;
  const current = shown.find((row) => key(row) === selected) ?? null;

  const save = useCallback(
    async (input: serviceBusApi.AzureServiceBusRuleInput) => {
      await serviceBusApi.createRule(connID, input);
      toast.success(t("board.azure-servicebus.rules.created", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  /*
   * The confirmation is about the last one rather than about this one. A
   * subscription with no rules is not an error anywhere: the service allows
   * it, the subscription stays Active, and its backlog stays empty because
   * nothing can arrive.
   */
  const remove = useCallback(
    async (row: ServiceBusRule) => {
      const siblings = rules.filter(
        (other) => other.topic === row.topic && other.subscription === row.subscription,
      );
      const ok = await confirm({
        title: t("board.azure-servicebus.rules.deleteTitle", { name: row.name }),
        description:
          siblings.length <= 1
            ? t("board.azure-servicebus.rules.deleteLastDesc", { subscription: row.subscription })
            : t("board.azure-servicebus.rules.deleteDesc", { subscription: row.subscription }),
        confirmLabel: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await serviceBusApi.removeRule(connID, row.topic, row.subscription, row.name);
        toast.success(t("board.azure-servicebus.rules.deleted", { name: row.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.azure-servicebus.rules.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, rules, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.azure-servicebus.exchanges")}
        subtitle={t("board.azure-servicebus.rules.count", {
          rules: rules.length,
          topics: topics.length,
        })}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button disabled={!state.online} onClick={() => setFormOpen(true)}>
              <Plus aria-hidden />
              {t("board.azure-servicebus.rules.create")}
            </Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-60 flex-none"
          value={search}
          placeholder={t("board.azure-servicebus.rules.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Toolbar>
      <RuleDialogAzureServiceBus
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={save}
      />
      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.azure-servicebus.rules.topic")}</TableHead>
                  <TableHead>{t("board.azure-servicebus.rules.subscription")}</TableHead>
                  <TableHead>{t("board.azure-servicebus.rules.name")}</TableHead>
                  <TableHead>{t("board.azure-servicebus.rules.filter")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  <TableRow
                    key={key(row)}
                    selected={selected === key(row)}
                    onClick={() => setSelected(key(row))}
                  >
                    <TableCell className="select-text">{row.topic}</TableCell>
                    <TableCell className="select-text">{row.subscription}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate select-text">{row.name}</span>
                        {row.name === DEFAULT_RULE && (
                          <OutlineTag>{t("board.azure-servicebus.rules.defaultBadge")}</OutlineTag>
                        )}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "mono3 text-[11px] select-text",
                        matchesNothing(row) && "text-(--c-warn-text)",
                      )}
                    >
                      {row.summary || DASH}
                    </TableCell>
                  </TableRow>
                ))}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {rules.length === 0
                        ? t("board.azure-servicebus.rules.none")
                        : t("board.common.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <RuleSheet
              key={key(current)}
              entry={current}
              onRemove={() => void remove(current)}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
      {!isBlocked(state) && (
        <StatusBar left={<span>{t("board.azure-servicebus.rules.note")}</span>} />
      )}
    </Page>
  );
}

export function RuleSheet({
  entry,
  onRemove,
  onClose,
}: {
  entry: ServiceBusRule;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DetailPanel width={380} onDismiss={onClose}>
      <DetailPanelHeader title={entry.name} onClose={onClose} />
      <DetailPanelBody>
        {matchesEverything(entry) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("board.azure-servicebus.rules.everythingNote")}
          </p>
        )}
        {matchesNothing(entry) && (
          <p className="text-xs leading-relaxed text-(--c-warn-text)">
            {t("board.azure-servicebus.rules.nothingNote")}
          </p>
        )}

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.rules.section.edge")}
          </SectionLabel>
          <KV
            rows={[
              [t("board.azure-servicebus.rules.topic"), entry.topic],
              [t("board.azure-servicebus.rules.subscription"), entry.subscription],
              [t("board.azure-servicebus.rules.kind"), entry.kind],
            ]}
          />
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.azure-servicebus.rules.section.filter")}
          </SectionLabel>
          {entry.kind === "correlation" && entry.correlation.length > 0 ? (
            <KV rows={entry.correlation} />
          ) : (
            <KV rows={[[t("board.azure-servicebus.rules.filter"), entry.summary || DASH]]} />
          )}
        </div>

        {entry.action != null && (
          <div>
            <SectionLabel className="mb-1.5">
              {t("board.azure-servicebus.rules.section.action")}
            </SectionLabel>
            <KV rows={[[t("board.azure-servicebus.rules.action"), entry.action]]} />
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("board.azure-servicebus.rules.actionNote")}
            </p>
          </div>
        )}
      </DetailPanelBody>
      <DetailPanelFooter>
        <span className="flex-1" />
        <Button variant="destructive" onClick={onRemove}>
          {t("common.delete")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}
