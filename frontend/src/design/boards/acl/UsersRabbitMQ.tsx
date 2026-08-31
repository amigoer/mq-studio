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
  KV,
  Panel,
  SectionLabel,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState, isBlocked } from "@/design/boards/BoardState";
import { useRabbitIdentities } from "@/hooks/rabbitmq/useRabbitIdentities";
import { useRabbitNamespaces } from "@/hooks/rabbitmq/useRabbitNamespaces";
import { useConnectionScope } from "@/mq/ConnectionScope";
import {
  canManage,
  grantsEverything,
  grantsNothing,
  hasNoAccess,
  isAdministrator,
  patternKind,
} from "@/mq/rabbitmq/permissions";
import { formatErrorMessage } from "@/lib/utils";
import * as rabbitApi from "@/api/rabbitmq";
import { IdentityDialog, PermissionDialog } from "./UserDialogs";
import type {
  Identity,
  IdentityInput,
  NamespacePermission,
  PermissionInput,
  TopicPermission,
} from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;

/**
 * RabbitMQ users and permissions - the ACL slot, filled by a page of
 * RabbitMQ's own shape.
 *
 * The canonical access ports do not fit and were never implemented for this
 * family. RocketMQ's plain_acl entry carries a key, a secret and its
 * permissions together; RabbitMQ splits the question in two and keeps the
 * halves in different places. A user's tags decide what the management API
 * lets it do, and its per-virtual-host permissions decide what its AMQP
 * connections may touch - so a user with every tag and no permission can read
 * every page here and open no queue.
 *
 * Both halves are therefore on the row, and the two failures they cause are
 * named rather than left to be worked out from an empty list.
 */
export function UsersRabbitMQ() {
  const { t } = useTranslation();
  const state = useRabbitIdentities();
  const namespaces = useRabbitNamespaces();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Identity | null>(null);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState<{ identity: string; existing?: NamespacePermission } | null>(
    null,
  );

  const identities = useMemo(() => state.data?.identities ?? [], [state.data]);
  const topicPermissions = useMemo(() => state.data?.topicPermissions ?? [], [state.data]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return identities
      .filter((identity) => needle === "" || identity.name.toLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [identities, search]);

  const detail = rows.find((identity) => identity.name === selected) ?? null;

  const saveIdentity = useCallback(
    async (input: IdentityInput) => {
      await rabbitApi.saveIdentity(connID, input);
      toast.success(t("board.acl.rabbitmq.saved", { name: input.name }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const savePermission = useCallback(
    async (input: PermissionInput) => {
      await rabbitApi.setPermission(connID, input);
      toast.success(t("board.acl.rabbitmq.permissionSaved", { vhost: input.vhost }));
      await state.refresh();
    },
    [connID, state, t],
  );

  const revoke = useCallback(
    async (identity: string, vhost: string) => {
      const ok = await confirm({
        title: t("board.acl.rabbitmq.revokeTitle", { identity, vhost }),
        /* Removing the record is not the same as granting nothing: the broker
           refuses the connection outright rather than letting it in to do
           nothing, and that is the more useful of the two. */
        description: t("board.acl.rabbitmq.revokeDesc"),
        confirmLabel: t("board.acl.rabbitmq.revoke"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.revokePermission(connID, vhost, identity);
        toast.success(t("board.acl.rabbitmq.revoked"));
        await state.refresh();
      } catch (revokeError) {
        toast.error(t("board.acl.rabbitmq.revokeFailed"), {
          description: formatErrorMessage(revokeError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  const remove = useCallback(
    async (identity: Identity) => {
      const ok = await confirm({
        title: t("board.acl.rabbitmq.deleteTitle", { name: identity.name }),
        description: t("board.acl.rabbitmq.deleteDesc"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await rabbitApi.deleteIdentity(connID, identity.name);
        toast.success(t("board.acl.rabbitmq.deleted", { name: identity.name }));
        setSelected(null);
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.acl.rabbitmq.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.acl.rabbitmq.title")}
        subtitle={t("board.acl.rabbitmq.subtitle")}
        actions={
          <>
            <Button disabled={!state.online} onClick={() => setCreating(true)}>
              {t("board.acl.rabbitmq.new")}
            </Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={state.refresh}
            />
          </>
        }
      />
      <IdentityDialog
        open={creating || editing != null}
        editing={editing ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={saveIdentity}
      />
      <PermissionDialog
        open={granting != null}
        identity={granting?.identity ?? ""}
        editing={granting?.existing}
        vhosts={(namespaces.data ?? []).map((vhost) => vhost.name)}
        onClose={() => setGranting(null)}
        onSubmit={savePermission}
      />
      {!isBlocked(state) && (
        <Toolbar>
          <Input
            className="w-[220px] flex-none"
            placeholder={t("board.acl.rabbitmq.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Toolbar>
      )}
      <ListArea>
        <ListPane>
          <BoardState
            state={state}
            empty={identities.length === 0 ? t("board.acl.rabbitmq.none") : undefined}
          >
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.user")}</TableHead>
                  <TableHead>{t("board.acl.rabbitmq.tags")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.acl.rabbitmq.vhostCount")}
                  </TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((identity) => (
                  <TableRow
                    key={identity.name}
                    selected={selected === identity.name}
                    onClick={() => setSelected(identity.name)}
                  >
                    <TableCell>
                      <b style={{ fontWeight: 500 }}>{identity.name}</b>
                    </TableCell>
                    <TableCell>
                      {(identity.tags ?? []).map((tag) => (
                        <Status
                          key={tag}
                          tone={tag === "administrator" ? "warn" : "off"}
                          style={TAG}
                        >
                          {tag}
                        </Status>
                      ))}
                      {(identity.tags ?? []).length === 0 && (
                        <span style={{ color: "var(--c-muted)", fontSize: "11px" }}>
                          {t("board.acl.rabbitmq.noTags")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {(identity.permissions ?? []).length}
                    </TableCell>
                    <TableCell>
                      <IdentityTone identity={identity} />
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && identities.length > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} style={{ color: "var(--c-muted)" }}>
                      {t("board.acl.rabbitmq.noMatch")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </BoardState>
        </ListPane>

        {detail != null && (
          <DetailPanel width={430} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader title={detail.name} onClose={() => setSelected(null)} />
            <DetailPanelBody>
              <IdentityDetail
                identity={detail}
                topicPermissions={topicPermissions.filter((p) => p.identity === detail.name)}
                onEditPermission={(existing) =>
                  setGranting({ identity: detail.name, existing })
                }
                onRevoke={(vhost) => void revoke(detail.name, vhost)}
              />
            </DetailPanelBody>
            <DetailPanelFooter>
              <Button variant="outline" onClick={() => setEditing(detail)}>
                {t("board.common.edit")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setGranting({ identity: detail.name })}
              >
                {t("board.acl.rabbitmq.grant")}
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

/**
 * The two ways a user can be configured into uselessness, named.
 *
 * Both produce failures that look like something else: no permission reads as
 * a wrong password to the application, and no management tag makes every page
 * in this app fail while AMQP keeps working.
 */
function IdentityTone({ identity }: { identity: Identity }) {
  const { t } = useTranslation();
  if (isAdministrator(identity)) {
    return <Status tone="warn">{t("board.acl.rabbitmq.administrator")}</Status>;
  }
  if (hasNoAccess(identity)) {
    return <Status tone="err">{t("board.acl.rabbitmq.noAccess")}</Status>;
  }
  if (!canManage(identity)) {
    return <Status tone="off">{t("board.acl.rabbitmq.amqpOnly")}</Status>;
  }
  return <Status tone="ok">{t("board.acl.rabbitmq.ok")}</Status>;
}

function IdentityDetail({
  identity,
  topicPermissions,
  onEditPermission,
  onRevoke,
}: {
  identity: Identity;
  topicPermissions: TopicPermission[];
  onEditPermission: (permission: NamespacePermission) => void;
  onRevoke: (vhost: string) => void;
}) {
  const { t } = useTranslation();
  const permissions = (identity.permissions ?? []).filter(
    (permission): permission is NamespacePermission => permission != null,
  );

  return (
    <>
      <KV
        rows={[
          [
            t("board.acl.rabbitmq.tags"),
            (identity.tags ?? []).join(", ") || t("board.acl.rabbitmq.noTags"),
          ],
          [
            t("board.acl.rabbitmq.password"),
            identity.hasPassword
              ? t("board.acl.rabbitmq.passwordSet")
              : t("board.acl.rabbitmq.passwordNone"),
          ],
        ]}
      />

      <div>
        <SectionLabel style={{ marginBottom: "6px" }}>
          {t("board.acl.rabbitmq.permissions", { count: permissions.length })}
        </SectionLabel>
        {permissions.length === 0 ? (
          <Panel style={{ padding: "9px 12px", fontSize: "11.5px", color: "var(--c-err-text)" }}>
            {/* Not merely empty: the broker refuses this user everywhere, and
                the application sees what looks like a wrong password. */}
            {t("board.acl.rabbitmq.noPermissionsWarn")}
          </Panel>
        ) : (
          <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {permissions.map((permission) => (
              <PermissionRow
                key={permission.namespace}
                permission={permission}
                onEdit={() => onEditPermission(permission)}
                onRevoke={() => onRevoke(permission.namespace)}
              />
            ))}
          </Panel>
        )}
      </div>

      {topicPermissions.length > 0 && (
        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>
            {t("board.acl.rabbitmq.topicPermissions")}
          </SectionLabel>
          <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "4px" }}>
            <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>
              {t("board.acl.rabbitmq.topicHint")}
            </span>
            {topicPermissions.map((permission) => (
              <div key={`${permission.namespace}/${permission.exchange}`} style={{ fontSize: "11.5px" }}>
                <span className="mono3" style={MONO11}>
                  {permission.namespace} · {permission.exchange}
                </span>{" "}
                <span style={{ color: "var(--c-mono-dim)" }}>
                  write {permission.write || "-"} · read {permission.read || "-"}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </>
  );
}

function PermissionRow({
  permission,
  onEdit,
  onRevoke,
}: {
  permission: NamespacePermission;
  onEdit: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="mono3" style={{ ...MONO11, flex: 1 }}>
          {permission.namespace}
        </span>
        {grantsEverything(permission) && (
          <Status tone="warn" style={TAG}>
            {t("board.acl.rabbitmq.full")}
          </Status>
        )}
        {grantsNothing(permission) && (
          <Status tone="err" style={TAG}>
            {t("board.acl.rabbitmq.nothing")}
          </Status>
        )}
        <button type="button" className="mqs-linkbtn" onClick={onEdit}>
          {t("board.common.edit")}
        </button>
        <button type="button" className="mqs-linkbtn" onClick={onRevoke}>
          {t("board.acl.rabbitmq.revoke")}
        </button>
      </div>
      <div style={{ display: "flex", gap: "10px", fontSize: "11px", color: "var(--c-mono-dim)" }}>
        <Pattern label="configure" pattern={permission.configure} />
        <Pattern label="write" pattern={permission.write} />
        <Pattern label="read" pattern={permission.read} />
      </div>
    </div>
  );
}

/**
 * One pattern, in the three states it actually has.
 *
 * An empty pattern permits nothing, and rendering it as blank would read as
 * "not set" - the opposite of what it does.
 */
function Pattern({ label, pattern }: { label: string; pattern: string }) {
  const { t } = useTranslation();
  const kind = patternKind(pattern);
  return (
    <span>
      {label}{" "}
      <span
        className="mono3"
        style={{ color: kind === "none" ? "var(--c-err-text)" : undefined }}
      >
        {kind === "none" ? t("board.acl.rabbitmq.patternNone") : pattern}
      </span>
    </span>
  );
}
