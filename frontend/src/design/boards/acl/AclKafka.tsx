import { useMemo, useState } from "react";
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
  Panel,
  SectionLabel,
  Segmented,
  Status,
  WarnBanner,
  useConfirm,
  useToast,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useKafkaAccess } from "@/hooks/kafka/useKafkaAccess";
import { removeKafkaAccessRule, removeKafkaPrincipal } from "@/api/kafka";
import { formatErrorMessage } from "@/lib/utils";
import { AclRuleDialogKafka } from "./AclRuleDialogKafka";
import { ScramUserDialogKafka } from "./ScramUserDialogKafka";

const MONO11 = { fontSize: "11px" } as const;

type Tab = "rules" | "users";

/**
 * Kafka access control, which is two systems on one cluster.
 *
 * The rules are ACLs: a principal, a resource, an operation and an effect,
 * stored one line each and shown grouped by subject because "what may this
 * service do" is answered by a subject's rules together.
 *
 * The users are SCRAM credentials, and they are the only identity store Kafka
 * keeps itself. A cluster authenticating over mTLS or Kerberos has principals
 * it never stores, so a rule can name someone who is not in the user list -
 * which is the truth about that cluster rather than a gap in this page.
 */
export function AclKafka() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("rules");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState(false);
  const [editingUser, setEditingUser] = useState(false);

  const state = useKafkaAccess();
  const enabled = state.data?.enabled ?? false;
  const rules = state.data?.rules ?? [];
  const principals = state.data?.principals ?? [];

  const visibleRules = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rules
      .filter((rule): rule is NonNullable<typeof rule> => rule != null)
      .filter((rule) => term === "" || rule.subject.toLowerCase().includes(term));
  }, [rules, search]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return principals
      .filter((user): user is NonNullable<typeof user> => user != null)
      .filter((user) => term === "" || user.name.toLowerCase().includes(term));
  }, [principals, search]);

  const current = visibleRules.find((rule) => rule.subject === selected) ?? null;

  const removeRule = async (subject: string) => {
    const ok = await confirm({
      title: t("board.acl.kafka.deleteRuleTitle", { subject }),
      description: t("board.acl.kafka.deleteRuleBody"),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeKafkaAccessRule(connID, subject);
      setSelected(null);
      await state.refresh();
      toast.success(t("board.acl.kafka.ruleDeleted", { subject }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  const removeUser = async (name: string) => {
    const ok = await confirm({
      title: t("board.acl.kafka.deleteUserTitle", { name }),
      description: t("board.acl.kafka.deleteUserBody"),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeKafkaPrincipal(connID, name);
      await state.refresh();
      toast.success(t("board.acl.kafka.userDeleted", { name }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.acl.kafka.title")}
        subtitle={t("board.acl.kafka.subtitle")}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            {enabled && (
              <Button onClick={() => (tab === "rules" ? setEditingRule(true) : setEditingUser(true))}>
                {tab === "rules" ? t("board.acl.kafka.newRule") : t("board.acl.kafka.newUser")}
              </Button>
            )}
          </>
        }
      />
      <Toolbar>
        <Segmented<Tab>
          options={[
            { value: "rules", label: t("board.acl.kafka.rules") },
            { value: "users", label: t("board.acl.kafka.users") },
          ]}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setSelected(null);
          }}
        />
        <Input
          className="w-[220px] flex-none"
          placeholder={t("board.acl.kafka.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
      </Toolbar>

      <BoardState state={state}>
        {/* Not an error state: the cluster runs without an authorizer, which
            is a deployment choice. The page says which system is on rather
            than failing over. */}
        {!enabled ? (
          <div style={{ padding: "18px 16px" }}>
            <WarnBanner>{t("board.acl.kafka.noAuthorizer")}</WarnBanner>
          </div>
        ) : (
          <ListArea>
            <ListPane>
              {tab === "rules" ? (
                <Table inset>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("board.acl.kafka.principal")}</TableHead>
                      <TableHead>{t("board.acl.kafka.grants")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRules.map((rule) => (
                      <TableRow
                        key={rule.subject}
                        selected={selected === rule.subject}
                        onClick={() => setSelected(rule.subject)}
                      >
                        <TableCell className="mono3" style={MONO11}>{rule.subject}</TableCell>
                        <TableCell style={{ color: "var(--c-muted)" }}>
                          {t("board.acl.kafka.nPolicies", { n: (rule.policies ?? []).length })}
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleRules.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2} style={{ padding: "18px", color: "var(--c-muted)" }}>
                          {t("board.acl.kafka.noRules")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              ) : (
                <Table inset>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("board.acl.kafka.user")}</TableHead>
                      <TableHead>{t("board.acl.kafka.mechanisms")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleUsers.map((user) => (
                      <TableRow key={user.name}>
                        <TableCell className="mono3" style={MONO11}>{user.name}</TableCell>
                        <TableCell className="mono3" style={MONO11}>{user.type}</TableCell>
                        <TableCell style={{ textAlign: "right" }}>
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => void removeUser(user.name)}
                          >
                            {t("board.common.delete")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleUsers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} style={{ padding: "18px", color: "var(--c-muted)" }}>
                          {t("board.acl.kafka.noUsers")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </ListPane>

            {tab === "rules" && current != null && (
              <DetailPanel width={470} onDismiss={() => setSelected(null)}>
                <DetailPanelHeader
                  title={current.subject}
                  tabs={[{ id: "policies", label: t("board.acl.kafka.grants") }]}
                  activeTab="policies"
                  onTabChange={() => {}}
                  onClose={() => setSelected(null)}
                />
                <DetailPanelBody>
                  <SectionLabel>{t("board.acl.kafka.grants")}</SectionLabel>
                  <Panel style={{ overflow: "hidden" }}>
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("board.acl.kafka.resource")}</TableHead>
                          <TableHead>{t("board.acl.kafka.operation")}</TableHead>
                          <TableHead>{t("board.acl.kafka.effect")}</TableHead>
                          <TableHead>{t("board.acl.kafka.from")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(current.policies ?? []).map((policy, index) => (
                          <TableRow key={`${policy?.resource}-${index}`}>
                            <TableCell className="mono3" style={MONO11}>{policy?.resource}</TableCell>
                            <TableCell className="mono3" style={MONO11}>
                              {(policy?.actions ?? []).join(", ")}
                            </TableCell>
                            <TableCell>
                              {policy?.effect === "Deny" ? (
                                <Status tone="err">Deny</Status>
                              ) : (
                                <Status tone="ok">Allow</Status>
                              )}
                            </TableCell>
                            <TableCell className="mono3" style={MONO11}>
                              {/* Empty means from anywhere, which is the
                                  default and not the same as unknown. */}
                              {(policy?.sourceIps ?? []).length === 0
                                ? t("board.acl.kafka.anywhere")
                                : (policy?.sourceIps ?? []).join(", ")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Panel>
                  <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {t("board.acl.kafka.denyNote")}
                  </span>
                </DetailPanelBody>
                <DetailPanelFooter>
                  <span className="flex-1" />
                  <Button variant="destructive" onClick={() => void removeRule(current.subject)}>
                    {t("board.acl.kafka.deleteRule")}
                  </Button>
                </DetailPanelFooter>
              </DetailPanel>
            )}
          </ListArea>
        )}
      </BoardState>

      <AclRuleDialogKafka
        open={editingRule}
        operations={state.data?.operations ?? []}
        resourceKinds={state.data?.resourceKinds ?? []}
        onClose={() => setEditingRule(false)}
        onSaved={() => void state.refresh()}
      />
      <ScramUserDialogKafka
        open={editingUser}
        onClose={() => setEditingUser(false)}
        onSaved={() => void state.refresh()}
      />
    </Page>
  );
}
