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
import { Panel, Status, toast, useConfirm } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { AclUserDialog } from "./AclUserDialog";
import { useRedisAcl } from "@/hooks/redis/useRedisAcl";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import type { AclUserDraft } from "@/api/redis";
import type { AclUser } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";
import {
  allowsAnonymousAccess,
  authMode,
  channelPatterns,
  commandRules,
  enabled,
  grantsEveryCommand,
  isDefaultUser,
  keyPatterns,
  reachesEveryKey,
  ruleLine,
  selectors,
  userName,
} from "@/mq/redis/acl";

const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 18d — Redis ACL users.
 *
 * A third access model, and it needs a page of its own for a reason that is
 * not cosmetic: RocketMQ's is a credential pair carrying its own permissions,
 * Kafka's is rules attached to a principal, and Redis puts the command rules,
 * the key patterns and the channel patterns all on the user. A page built for
 * either of the others would show the commands and hide the half that decides
 * what data an account can reach.
 *
 * Every rule is shown in the server's own words. The language has more forms
 * than a form can model - allkeys and ~* mean the same thing, %R~ splits reads
 * from writes, selectors nest - so the columns summarise and the rule line is
 * there in full underneath.
 */
export function AclRedis() {
  const { t } = useTranslation();
  const state = useRedisAcl();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AclUser | null>(null);
  const [creating, setCreating] = useState(false);

  const users = useMemo(
    () => (state.data?.users ?? []).filter((user) => user != null),
    [state.data],
  );
  const categories = state.data?.categories ?? [];

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter(
      (user) => needle === "" || userName(user).toLowerCase().includes(needle),
    );
  }, [search, users]);

  const anonymous = useMemo(() => allowsAnonymousAccess(users), [users]);

  const save = useCallback(
    async (draft: AclUserDraft) => {
      await redisApi.saveAclUser(connID, draft);
      toast.success(t("board.acl.redis.saved", { name: draft.name }));
      setEditing(null);
      setCreating(false);
      await state.refresh();
    },
    [connID, state, t],
  );

  const remove = useCallback(
    async (user: AclUser) => {
      const ok = await confirm({
        title: t("board.acl.redis.deleteTitle", { name: userName(user) }),
        /* Redis closes the connections authenticated as the user itself, so
           an application using it stops working at once rather than at its
           next reconnect. */
        description: t("board.acl.redis.deleteHint"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await redisApi.removeAclUser(connID, userName(user));
        toast.success(t("board.acl.redis.deleted", { name: userName(user) }));
        await state.refresh();
      } catch (deleteError) {
        toast.error(t("board.acl.redis.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, state, t],
  );

  return (
    <Page>
      <AclUserDialog
        open={creating || editing != null}
        user={editing}
        categories={categories}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSave={save}
      />
      <PageHeader
        title={t("board.acl.redis.title")}
        subtitle={t("board.acl.redis.subtitle")}
        actions={
          <>
            <Button onClick={() => setCreating(true)}>{t("board.acl.redis.newUser")}</Button>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-[220px] flex-none"
          placeholder={t("board.acl.redis.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
        {/* The single most consequential row on the page: a default user that
            is on and accepts any password is a Redis reachable without
            credentials. */}
        {anonymous && <Status tone="warn">{t("board.acl.redis.anonymous")}</Status>}
      </Toolbar>

      <BoardState
        state={state}
        empty={
          rows.length === 0 ? (
            <ListArea>
              <ListPane>
                <div
                  style={{
                    padding: "24px",
                    fontSize: "11.5px",
                    color: "var(--c-muted)",
                    textAlign: "center",
                  }}
                >
                  {users.length === 0
                    ? t("board.acl.redis.none")
                    : t("board.acl.redis.noMatches")}
                </div>
              </ListPane>
            </ListArea>
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>user</TableHead>
                  <TableHead>{t("board.acl.redis.auth")}</TableHead>
                  <TableHead>{t("board.acl.redis.keys")}</TableHead>
                  <TableHead>{t("board.acl.redis.channels")}</TableHead>
                  <TableHead>{t("board.acl.redis.commands")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => (
                  <TableRow key={userName(user)}>
                    <TableCell>
                      <b className="mono3" style={{ fontWeight: 500, fontSize: "11.5px" }}>
                        {userName(user)}
                      </b>
                      {!enabled(user) && (
                        <Status tone="off" style={{ marginLeft: "6px", fontSize: "10px" }}>
                          off
                        </Status>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {/* "any" and "none" are opposite outcomes and the words
                          have to say which is which: one accepts every
                          password, the other accepts none at all. */}
                      <Status tone={authMode(user) === "any" ? "warn" : "off"}>
                        {t(`board.acl.redis.mode.${authMode(user)}`)}
                      </Status>
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {reachesEveryKey(user) ? (
                        <Status tone="warn">{t("board.acl.redis.allKeys")}</Status>
                      ) : (
                        (keyPatterns(user).join(" ") || "—")
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {channelPatterns(user).join(" ") || "—"}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {grantsEveryCommand(user) ? (
                        <Status tone="warn">+@all</Status>
                      ) : (
                        (commandRules(user) || "—")
                      )}
                      {selectors(user).length > 0 && (
                        <Status tone="off" style={{ marginLeft: "6px", fontSize: "10px" }}>
                          {t("board.acl.redis.selectors", { count: selectors(user).length })}
                        </Status>
                      )}
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      <Button variant="ghost" size="xs" onClick={() => setEditing(user)}>
                        {t("board.common.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        /* Redis refuses it too, but a disabled control says so
                           without anyone having to try. */
                        disabled={isDefaultUser(user)}
                        onClick={() => void remove(user)}
                      >
                        {t("board.common.delete")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {rows.length > 0 && (
              <Panel style={{ margin: "10px 12px", padding: "10px 14px" }}>
                <div style={{ fontSize: "10.5px", color: "var(--c-muted)", marginBottom: "6px" }}>
                  {t("board.acl.redis.rules")}
                </div>
                {/* The whole rule as the server stated it. The columns
                    summarise; this is the form guaranteed to be complete, and
                    the one an operator can paste into redis-cli to check. */}
                <pre
                  className="mono3"
                  style={{ fontSize: "11px", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                >
                  {rows.map((user) => ruleLine(user)).join("\n")}
                </pre>
              </Panel>
            )}
          </ListPane>
        </ListArea>
      </BoardState>
    </Page>
  );
}
