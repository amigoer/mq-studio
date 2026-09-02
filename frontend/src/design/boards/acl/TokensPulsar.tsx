import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  OutlineTag,
  Panel,
  PanelHeader,
  SelectField,
  toast,
  useConfirm,
} from "@/components";
import { Page, PageBody, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { usePulsarNamespaces } from "@/hooks/pulsar/usePulsarNamespaces";
import { usePulsarTopics } from "@/hooks/pulsar/usePulsarTopics";
import {
  usePulsarNamespaceGrants,
  usePulsarTopicGrants,
} from "@/hooks/pulsar/usePulsarPermissions";
import * as pulsarApi from "@/api/pulsar";
import {
  canConfigure,
  canRead,
  canWrite,
  configurableAt,
  emptyGrantForm,
  grantTopic,
  validateGrant,
  type PulsarGrantForm,
} from "@/mq/pulsar/permissions";
import { topicURL } from "@/mq/pulsar/destinations";
import { formatErrorMessage } from "@/lib/utils";

/**
 * Board 18c — Pulsar tokens.
 *
 * Called Tokens rather than Users because Pulsar has no users. It authorises
 * the *subject of a token* - a role - and keeps no directory of them: a grant
 * can name a role that does not exist yet and will be honoured the moment a
 * token carrying it turns up. So this page creates no accounts and sets no
 * passwords; it reads and writes grants, which is all the cluster stores.
 *
 * Two scopes, two tables, because Pulsar stores them separately and they mean
 * different things: a namespace grant covers everything in it, and a topic
 * grant covers one topic. Revoking one does not touch the other, and the two
 * reach different endpoints.
 *
 * Configure appears only on a namespace grant, and that is Pulsar's shape
 * rather than a gap: functions, sinks and packages are deployed into a
 * namespace, not into a topic.
 */
export function TokensPulsar() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const namespaces = usePulsarNamespaces();
  const [namespace, setNamespace] = useState("");
  const scope = namespace || (namespaces.data?.[0]?.name ?? "");

  const grants = usePulsarNamespaceGrants(scope);
  const topicGrants = usePulsarTopicGrants(grants.online);
  const topics = usePulsarTopics(scope);

  const [granting, setGranting] = useState(false);

  const refreshAll = async () => {
    await grants.refresh();
    await topicGrants.refresh();
  };

  const grant = async (form: PulsarGrantForm) => {
    await pulsarApi.grantPulsarRole(connID, {
      namespace: scope,
      topic: form.topic,
      role: form.role.trim(),
      configure: form.configure,
      write: form.write,
      read: form.read,
    } as pulsarApi.PulsarGrantInput);
    await refreshAll();
    toast.success(t("board.acl.pulsar.granted", { role: form.role.trim() }));
  };

  const revokeNamespace = async (role: string) => {
    const ok = await confirm({
      title: t("board.acl.pulsar.revokeTitle"),
      description: t("board.acl.pulsar.revokeNamespaceBody", { role, namespace: scope }),
      confirmLabel: t("board.acl.pulsar.revoke"),
      danger: true,
    });
    if (!ok) return;
    try {
      await pulsarApi.revokePulsarNamespace(connID, scope, role);
      await refreshAll();
      toast.success(t("board.acl.pulsar.revoked", { role }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  const revokeTopic = async (topic: string, role: string) => {
    const ok = await confirm({
      title: t("board.acl.pulsar.revokeTitle"),
      description: t("board.acl.pulsar.revokeTopicBody", { role, topic }),
      confirmLabel: t("board.acl.pulsar.revoke"),
      danger: true,
    });
    if (!ok) return;
    try {
      await pulsarApi.revokePulsarTopic(connID, topic, role);
      await refreshAll();
      toast.success(t("board.acl.pulsar.revoked", { role }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.acl.pulsar.title")}
        subtitle={scope}
        actions={
          <>
            <Button size="sm" onClick={() => setGranting(true)} disabled={!grants.online}>
              <Plus size={14} aria-hidden />
              {t("board.acl.pulsar.grant")}
            </Button>
            <RefreshButton
              refreshing={grants.refreshing}
              online={grants.online}
              onClick={() => void refreshAll()}
            />
          </>
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
        {/* Said once, on the page, because it is the thing that surprises
            anybody arriving from a family with users. */}
        <span className="text-xs text-muted-foreground">
          {t("board.acl.pulsar.rolesNote")}
        </span>
      </Toolbar>

      <BoardState state={grants}>
        <PageBody>
          <Panel>
            <PanelHeader title={t("board.acl.pulsar.namespaceGrants")} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.acl.pulsar.role")}</TableHead>
                  <TableHead>{t("board.acl.pulsar.permissions")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grants.data ?? []).map((permission) => (
                  <TableRow key={permission.identity}>
                    <TableCell className="mono3">{permission.identity}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {canConfigure(permission) && (
                          <OutlineTag>{t("board.acl.pulsar.configure")}</OutlineTag>
                        )}
                        {canWrite(permission) && (
                          <OutlineTag>{t("board.acl.pulsar.produce")}</OutlineTag>
                        )}
                        {canRead(permission) && (
                          <OutlineTag>{t("board.acl.pulsar.consume")}</OutlineTag>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void revokeNamespace(permission.identity)}
                      >
                        <Trash2 size={13} aria-hidden />
                        {t("board.acl.pulsar.revoke")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <Panel>
            <PanelHeader title={t("board.acl.pulsar.topicGrants")} />
            <BoardState
              state={topicGrants}
              empty={
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {t("board.acl.pulsar.noTopicGrants")}
                </p>
              }
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("board.acl.pulsar.role")}</TableHead>
                    <TableHead>{t("board.acl.pulsar.topic")}</TableHead>
                    <TableHead>{t("board.acl.pulsar.permissions")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(topicGrants.data ?? []).map((permission) => (
                    <TableRow key={`${grantTopic(permission)}/${permission.identity}`}>
                      <TableCell className="mono3">{permission.identity}</TableCell>
                      <TableCell className="mono3">{grantTopic(permission)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {canWrite(permission) && (
                            <OutlineTag>{t("board.acl.pulsar.produce")}</OutlineTag>
                          )}
                          {canRead(permission) && (
                            <OutlineTag>{t("board.acl.pulsar.consume")}</OutlineTag>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            void revokeTopic(grantTopic(permission), permission.identity)
                          }
                        >
                          <Trash2 size={13} aria-hidden />
                          {t("board.acl.pulsar.revoke")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </BoardState>
          </Panel>
        </PageBody>
      </BoardState>

      <GrantDialog
        open={granting}
        namespace={scope}
        topics={(topics.data ?? []).map(topicURL)}
        onClose={() => setGranting(false)}
        onSubmit={grant}
      />
    </Page>
  );
}

/**
 * Grant a role access.
 *
 * The empty grant is refused rather than sent, and that is not pedantry:
 * Pulsar's grant replaces a role's whole action list instead of adding to it,
 * so a grant with nothing ticked would silently revoke - which is the other
 * button, with its own confirmation.
 */
function GrantDialog({
  open,
  namespace,
  topics,
  onClose,
  onSubmit,
}: {
  open: boolean;
  namespace: string;
  topics: string[];
  onClose: () => void;
  onSubmit: (form: PulsarGrantForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PulsarGrantForm>(emptyGrantForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PulsarGrantForm>(key: K, value: PulsarGrantForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const invalid = validateGrant(form, t);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(form);
      setForm(emptyGrantForm());
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const NAMESPACE_WIDE = "__namespace__";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>{t("board.acl.pulsar.grantTitle")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="grant-role">{t("board.acl.pulsar.role")}</FieldLabel>
            <Input
              id="grant-role"
              className="mono3"
              value={form.role}
              placeholder="order-service"
              onChange={(event) => set("role", event.target.value)}
            />
            <FieldDescription>{t("board.acl.pulsar.roleHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.pulsar.scope")}</FieldLabel>
            <SelectField
              className="w-full"
              value={form.topic === "" ? NAMESPACE_WIDE : form.topic}
              options={[
                { value: NAMESPACE_WIDE, label: t("board.acl.pulsar.wholeNamespace", { namespace }) },
                ...topics.map((topic) => ({ value: topic, label: topic })),
              ]}
              onValueChange={(next) =>
                setForm((previous) => ({
                  ...previous,
                  topic: next === NAMESPACE_WIDE ? "" : next,
                  // Configure is namespace-only, so narrowing the scope drops
                  // it rather than leaving a tick that would be ignored.
                  configure: next === NAMESPACE_WIDE ? previous.configure : false,
                }))
              }
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.acl.pulsar.permissions")}</FieldLabel>
            <div className="flex flex-col gap-2 text-xs">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.write}
                  onCheckedChange={(next) => set("write", next === true)}
                />
                {t("board.acl.pulsar.produceHint")}
              </label>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={form.read}
                  onCheckedChange={(next) => set("read", next === true)}
                />
                {t("board.acl.pulsar.consumeHint")}
              </label>
              {configurableAt(form.topic) && (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={form.configure}
                    onCheckedChange={(next) => set("configure", next === true)}
                  />
                  {t("board.acl.pulsar.configureHint")}
                </label>
              )}
            </div>
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.acl.pulsar.replacesNote")}
        </FieldDescription>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "max-w-80 text-right text-xs " +
                (error != null ? "text-(--c-err)" : "text-muted-foreground")
              }
            >
              {error ?? invalid}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={invalid != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.acl.pulsar.grant")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
