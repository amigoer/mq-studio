import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageBody, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Panel, Segmented, Status, useConfirm, useToast } from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as aclApi from "@/api/acl";
import type { AccessPrincipal, AccessRule } from "@/api/acl";
import { formatErrorMessage } from "@/lib/utils";
import { PlainAccess } from "./PlainAccess";
import { PrincipalDialog, type PrincipalForm } from "./PrincipalDialog";
import { RuleDialog, type RuleForm } from "./RuleDialog";

const TABS = ["principals", "rules", "plain"] as const;
type Tab = (typeof TABS)[number];

interface AclState {
  /** RocketMQ 5.3 authentication: readable, and what the first two tabs need. */
  directory: boolean;
  /** 4.x plain_acl. Writable either way; readable never. */
  legacy: boolean;
  version: string;
}

/**
 * Board — access control, in whichever of RocketMQ's two systems is running.
 *
 * They are not two views of one thing. 4.x plain_acl carries the credential
 * and the permissions in one file entry and the admin protocol has no call
 * that reads it back, so a page on top of it can only edit blind. 5.3's auth
 * is a store of identities with rules attached, and both listings answer.
 *
 * Which system is on decides what the page offers: the two directory tabs are
 * disabled with the reason on a broker that is not running 5.3 auth, rather
 * than drawn empty as though nobody had configured anything.
 */
export function Acl() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("principals");
  const [principalDialog, setPrincipalDialog] = useState<{ editing?: AccessPrincipal } | null>(null);
  const [ruleDialog, setRuleDialog] = useState<{ editing?: AccessRule } | null>(null);

  const loadState = useCallback(async (id: number): Promise<AclState> => {
    const [directory, legacy, version] = await Promise.all([
      aclApi.getAclDirectoryEnabled(id).catch(() => false),
      aclApi.getAclEnabled(id).catch(() => false),
      // Only 4.x answers this, and only some builds of it.
      aclApi.getAclVersion(id).then((info) => info.version).catch(() => ""),
    ]);
    return { directory, legacy, version };
  }, []);
  const state = useBrokerData(loadState);
  const directory = state.data?.directory ?? false;

  const loadPrincipals = useCallback((id: number) => aclApi.getAclPrincipals(id), []);
  const principals = useBrokerData(loadPrincipals, {
    refreshMs: null,
    enabled: directory && tab === "principals",
  });

  const loadRules = useCallback((id: number) => aclApi.getAclRules(id), []);
  const rules = useBrokerData(loadRules, {
    refreshMs: null,
    enabled: directory && tab === "rules",
  });

  const savePrincipal = async (form: PrincipalForm) => {
    await aclApi.updateAclPrincipal(connID, form.name, form.secret, form.type, form.status);
    toast.success(t("board.acl.principal.saved", { name: form.name }));
    await principals.refresh();
  };

  const removePrincipal = async (principal: AccessPrincipal) => {
    const confirmed = await confirm({
      title: t("board.acl.principal.deleteTitle"),
      description: t("board.acl.principal.deleteDesc", { name: principal.name }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await aclApi.deleteAclPrincipal(connID, principal.name);
      toast.success(t("board.acl.principal.deleted", { name: principal.name }));
      await principals.refresh();
    } catch (failure) {
      toast.error(t("board.acl.principal.deleteFailed"), {
        description: formatErrorMessage(failure),
      });
    }
  };

  const saveRule = async (form: RuleForm) => {
    await aclApi.updateAclRule(connID, form.subject, form.description, form.policies);
    toast.success(t("board.acl.rule.saved", { subject: form.subject }));
    await rules.refresh();
  };

  const removeRule = async (rule: AccessRule) => {
    const confirmed = await confirm({
      title: t("board.acl.rule.deleteTitle"),
      description: t("board.acl.rule.deleteDesc", { subject: rule.subject }),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await aclApi.deleteAclRule(connID, rule.subject);
      toast.success(t("board.acl.rule.deleted", { subject: rule.subject }));
      await rules.refresh();
    } catch (failure) {
      toast.error(t("board.acl.rule.deleteFailed"), { description: formatErrorMessage(failure) });
    }
  };

  const subtitle = state.data == null
    ? t("board.acl.subtitleUnknown")
    : state.data.directory
      ? t("board.acl.subtitleDirectory")
      : state.data.legacy
        ? t("board.acl.subtitleLegacy")
        : t("board.acl.subtitleOff");

  return (
    <Page>
      <PageHeader
        title="ACL"
        subtitle={subtitle}
        actions={
          <>
            {tab !== "plain" && directory && (
              <Button
                onClick={() =>
                  tab === "principals" ? setPrincipalDialog({}) : setRuleDialog({})
                }
              >
                {t(tab === "principals" ? "board.acl.principal.create" : "board.acl.rule.create")}
              </Button>
            )}
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => {
                void state.refresh();
                void principals.refresh();
                void rules.refresh();
              }}
            />
          </>
        }
      />

      <Toolbar>
        <Segmented
          value={tab}
          onChange={setTab}
          options={TABS.map((key) => ({ value: key, label: t(`board.acl.tabs.${key}`) }))}
        />
        {state.data?.version !== undefined && state.data.version !== "" && (
          <span className="mono3 text-xs text-(--c-muted)">
            {t("board.acl.version", { version: state.data.version })}
          </span>
        )}
      </Toolbar>

      {isBlocked(state) ? (
        <BoardState state={state} />
      ) : (
        <PageBody>
          {tab === "plain" ? (
            <PlainAccess />
          ) : !directory ? (
            <Notice title={t("board.acl.directoryOff")}>{t("board.acl.directoryOffHint")}</Notice>
          ) : tab === "principals" ? (
            <PrincipalTable
              state={principals}
              onEdit={(principal) => setPrincipalDialog({ editing: principal })}
              onDelete={(principal) => void removePrincipal(principal)}
            />
          ) : (
            <RuleList
              state={rules}
              onEdit={(rule) => setRuleDialog({ editing: rule })}
              onDelete={(rule) => void removeRule(rule)}
            />
          )}
        </PageBody>
      )}

      <PrincipalDialog
        open={principalDialog != null}
        editing={principalDialog?.editing}
        onClose={() => setPrincipalDialog(null)}
        onSubmit={savePrincipal}
      />
      <RuleDialog
        open={ruleDialog != null}
        editing={ruleDialog?.editing}
        subjects={(principals.data ?? []).map((principal) => principal.name)}
        onClose={() => setRuleDialog(null)}
        onSubmit={saveRule}
      />
    </Page>
  );
}

function PrincipalTable({
  state,
  onEdit,
  onDelete,
}: {
  state: ReturnType<typeof useBrokerData<AccessPrincipal[]>>;
  onEdit: (principal: AccessPrincipal) => void;
  onDelete: (principal: AccessPrincipal) => void;
}) {
  const { t } = useTranslation();
  const rows = state.data ?? [];

  if (isBlocked(state)) return <BoardState state={state} />;
  if (rows.length === 0) return <Notice title={t("board.acl.principal.none")} />;

  return (
    <Panel className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("board.acl.principal.name")}</TableHead>
            <TableHead>{t("board.acl.principal.type")}</TableHead>
            <TableHead>{t("board.acl.principal.status")}</TableHead>
            <TableHead style={{ textAlign: "right" }}>{t("board.common.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((principal) => (
            <TableRow key={principal.name}>
              <TableCell className="mono3">{principal.name}</TableCell>
              <TableCell>{principal.type || "—"}</TableCell>
              <TableCell>
                <Status tone={principal.status === "disable" ? "off" : "ok"}>
                  {principal.status || "—"}
                </Status>
              </TableCell>
              <TableCell style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <Button variant="ghost" size="xs" onClick={() => onEdit(principal)}>
                  {t("board.common.edit")}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => onDelete(principal)}>
                  {t("board.common.delete")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function RuleList({
  state,
  onEdit,
  onDelete,
}: {
  state: ReturnType<typeof useBrokerData<AccessRule[]>>;
  onEdit: (rule: AccessRule) => void;
  onDelete: (rule: AccessRule) => void;
}) {
  const { t } = useTranslation();
  const rows = state.data ?? [];

  if (isBlocked(state)) return <BoardState state={state} />;
  if (rows.length === 0) return <Notice title={t("board.acl.rule.none")} />;

  return (
    <div className="flex flex-col gap-2">
      {rows.map((rule) => (
        <Panel key={rule.subject} className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <b className="mono3 text-[12.5px]">{rule.subject}</b>
            {rule.description !== "" && (
              <span className="text-xs text-(--c-muted)">{rule.description}</span>
            )}
            <span className="flex-1" />
            <Button variant="ghost" size="xs" onClick={() => onEdit(rule)}>
              {t("board.common.edit")}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onDelete(rule)}>
              {t("board.common.delete")}
            </Button>
          </div>

          {rule.policies.length === 0 ? (
            <span className="text-xs text-(--c-muted)">{t("board.acl.rule.noPolicies")}</span>
          ) : (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.acl.rule.resource")}</TableHead>
                  <TableHead>{t("board.acl.rule.actions")}</TableHead>
                  <TableHead>{t("board.acl.rule.effect")}</TableHead>
                  <TableHead>{t("board.acl.rule.source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rule.policies.map((policy, index) => (
                  <TableRow key={`${policy.resource}-${index}`}>
                    <TableCell className="mono3">{policy.resource}</TableCell>
                    <TableCell className="mono3 text-(--c-mono-dim)">
                      {policy.actions.join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Status tone={policy.effect === "Deny" ? "err" : "ok"}>
                        {policy.effect || "—"}
                      </Status>
                    </TableCell>
                    <TableCell className="mono3 text-(--c-mono-dim)">
                      {policy.sourceIps.length === 0
                        ? t("board.acl.rule.anySource")
                        : policy.sourceIps.join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      ))}
    </div>
  );
}
