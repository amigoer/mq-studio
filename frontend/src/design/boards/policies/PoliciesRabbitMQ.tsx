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
  JsonBlock,
  KV,
  Panel,
  SectionLabel,
  Segmented,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useRabbitPolicies } from "@/hooks/rabbitmq/useRabbitPolicies";
import { useRabbitNamespaces } from "@/hooks/rabbitmq/useRabbitNamespaces";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import * as rabbitApi from "@/api/rabbitmq";
import { PolicyDialog } from "./PolicyDialog";
import type { Policy, PolicyInput, RuntimeParameter } from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

type Tab = "policies" | "parameters";

/**
 * RabbitMQ policies.
 *
 * This is the edit form the queue page does not have. A queue's arguments are
 * fixed at declaration, so the only way to change a live queue's TTL, length
 * limit or dead-letter exchange is a policy whose pattern matches it - which
 * makes this the page where a running system is actually reconfigured.
 *
 * The rule the page repeats, because it is the one people get wrong: policies
 * do not merge. Only the highest-priority match applies, and everything the
 * others would have set is simply not applied.
 */
export function PoliciesRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitPolicies();
  const namespaces = useRabbitNamespaces();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("policies");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);

  const policies = useMemo(() => state.data?.policies ?? [], [state.data]);
  const parameters = useMemo(() => state.data?.parameters ?? [], [state.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return policies
      .filter(
        (policy) =>
          needle === "" ||
          policy.name.toLowerCase().includes(needle) ||
          policy.pattern.toLowerCase().includes(needle),
      )
      /* Highest priority first, because that is the order the broker resolves
         them in and the first match is the only one that applies. */
      .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  }, [policies, search]);

  const detail = rows.find((policy) => policyKey(policy) === selected) ?? null;

  const save = useCallback(
    async (input: PolicyInput) => {
      await rabbitApi.savePolicy(connID, input);
      toast.success(t("board.policies.rabbitmq.saved", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (policy: Policy) => {
      const ok = await confirm({
        title: t("board.policies.rabbitmq.deleteTitle", { name: policy.name }),
        /* Everything it was applying reverts to whatever each destination was
           declared with, immediately and with no warning from the broker. */
        description: t("board.policies.rabbitmq.deleteDesc", { pattern: policy.pattern }),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deletePolicy(connID, policy.namespace, policy.name, policy.operator);
        toast.success(t("board.policies.rabbitmq.deleted", { name: policy.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.policies.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const removeParameter = useCallback(
    async (parameter: RuntimeParameter) => {
      const ok = await confirm({
        title: t("board.policies.rabbitmq.deleteParameterTitle", { name: parameter.name }),
        description: t("board.policies.rabbitmq.deleteParameterDesc", {
          component: parameter.component,
        }),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteRuntimeParameter(
          connID,
          parameter.component,
          parameter.namespace,
          parameter.name,
        );
        toast.success(t("board.policies.rabbitmq.parameterDeleted", { name: parameter.name }));
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.policies.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.policies.rabbitmq.title")}
        subtitle={t("board.policies.rabbitmq.subtitle")}
        actions={
          <>
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              {t("board.policies.rabbitmq.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={state.refresh}
            />
          </>
        }
      />
      <PolicyDialog
        open={creating || editing != null}
        editing={editing ?? undefined}
        vhosts={(namespaces.data ?? []).map((vhost) => vhost.name)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={save}
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Segmented
            value={tab}
            onChange={(next: Tab) => setTab(next)}
            options={[
              { value: "policies", label: t("board.policies.rabbitmq.tabPolicies") },
              {
                value: "parameters",
                label: t("board.policies.rabbitmq.tabParameters", { count: parameters.length }),
              },
            ]}
          />
          {tab === "policies" && (
            <Input
              className="w-[220px] flex-none"
              placeholder={t("board.policies.rabbitmq.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={
              tab === "policies" && policies.length === 0
                ? t("board.policies.rabbitmq.none")
                : undefined
            }
          >
            {tab === "policies" ? (
              <Table inset>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.policies.rabbitmq.name")}</TableHead>
                    <TableHead>vhost</TableHead>
                    <TableHead>{t("board.policies.rabbitmq.pattern")}</TableHead>
                    <TableHead>{t("board.policies.rabbitmq.applyTo")}</TableHead>
                    <TableHead style={{ textAlign: "right" }}>
                      {t("board.policies.rabbitmq.priority")}
                    </TableHead>
                    <TableHead>{t("board.common.features")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((policy) => (
                    <TableRow
                      key={policyKey(policy)}
                      selected={selected === policyKey(policy)}
                      onClick={() => setSelected(policyKey(policy))}
                    >
                      <TableCell>
                        <b style={{ fontWeight: 500 }}>{policy.name}</b>
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {policy.namespace}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {policy.pattern}
                      </TableCell>
                      <TableCell>{policy.applyTo}</TableCell>
                      <TableCell className="mono3" style={{ textAlign: "right" }}>
                        {policy.priority}
                      </TableCell>
                      <TableCell>
                        {/* An operator policy is set by whoever runs the
                            broker and overrides the user one where they set
                            the same key, which is the point of them. */}
                        {policy.operator && (
                          <Status tone="warn" style={TAG}>
                            operator
                          </Status>
                        )}
                        {definitionKeys(policy).map((key) => (
                          <Status key={key} tone="off" style={TAG}>
                            {key}
                          </Status>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && policies.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={6} style={{ color: "var(--c-muted)" }}>
                        {t("board.policies.rabbitmq.noMatch")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            ) : (
              <ParameterList parameters={parameters} onRemove={removeParameter} />
            )}
          </BoardState>
        </ListPane>

        {detail != null && tab === "policies" && (
          <DetailPanel width={400} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader title={detail.name} onClose={() => setSelected(null)} />
            <DetailPanelBody>
              <KV
                rows={[
                  ["vhost", detail.namespace],
                  [
                    t("board.policies.rabbitmq.pattern"),
                    <span key="p" className="mono3" style={MONO11}>
                      {detail.pattern}
                    </span>,
                  ],
                  [t("board.policies.rabbitmq.applyTo"), detail.applyTo],
                  [t("board.policies.rabbitmq.priority"), String(detail.priority)],
                  [
                    t("board.policies.rabbitmq.kind"),
                    detail.operator
                      ? t("board.policies.rabbitmq.operatorPolicy")
                      : t("board.policies.rabbitmq.userPolicy"),
                  ],
                ]}
              />
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>
                  {t("board.policies.rabbitmq.definition")}
                </SectionLabel>
                <JsonBlock>{detail.definition || "{}"}</JsonBlock>
              </div>
              <Panel style={{ padding: "9px 12px", fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.policies.rabbitmq.priorityNote")}
              </Panel>
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline" onClick={() => setEditing(detail)}>
                {t("board.common.edit")}
              </Button>
              <span className="flex-1" />
              <Button variant="destructive" onClick={() => void remove(detail)}>
                {t("board.common.delete")}
              </Button>
            </DetailPanelFooter>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/** A policy is unique per virtual host and kind, not by name alone. */
function policyKey(policy: Policy): string {
  return `${policy.operator ? "op" : "user"}/${policy.namespace}/${policy.name}`;
}

/** The keys a policy sets, which is what the row is really about. */
function definitionKeys(policy: Policy): string[] {
  try {
    const parsed: unknown = JSON.parse(policy.definition || "{}");
    return typeof parsed === "object" && parsed !== null ? Object.keys(parsed) : [];
  } catch {
    return [];
  }
}

/**
 * The broker's stored component configuration.
 *
 * Read and delete only. A parameter's shape belongs to whichever plugin owns
 * the component, so an editor here would be a way to write configuration
 * nothing validates - shovels and federation get typed pages instead. Showing
 * them is still worth it: it is where those pages' settings actually live, and
 * a parameter from a component nobody recognises is a plugin someone enabled.
 */
function ParameterList({
  parameters,
  onRemove,
}: {
  parameters: RuntimeParameter[];
  onRemove: (parameter: RuntimeParameter) => void;
}) {
  const { t } = useTranslation();
  if (parameters.length === 0) {
    return (
      <Panel style={{ margin: "10px", padding: "12px 16px", fontSize: "11.5px", color: "var(--c-muted)" }}>
        {t("board.policies.rabbitmq.noParameters")}
      </Panel>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px" }}>
      <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
        {t("board.policies.rabbitmq.parameterHint")}
      </span>
      {parameters.map((parameter) => (
        <Panel
          key={`${parameter.component}/${parameter.namespace}/${parameter.name}`}
          style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "6px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Status tone="off" style={TAG}>
              {parameter.component}
            </Status>
            <b style={{ fontWeight: 500 }}>{parameter.name}</b>
            <span className="mono3" style={{ ...MONO11, color: "var(--c-muted)" }}>
              {parameter.namespace}
            </span>
            <span className="flex-1" />
            <button type="button" className="mqs-linkbtn" onClick={() => onRemove(parameter)}>
              {t("board.common.delete")}
            </button>
          </div>
          <JsonBlock>{parameter.value}</JsonBlock>
        </Panel>
      ))}
    </div>
  );
}
