import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListPane, Page, PageHeader, RefreshButton, Toolbar } from "@/design/shell";
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
import { Status, useConfirm, useToast } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useKafkaQuotas } from "@/hooks/kafka/useKafkaQuotas";
import { removeKafkaQuota } from "@/api/kafka";
import { formatCount } from "@/lib/format";
import { formatErrorMessage } from "@/lib/utils";
import { quotaLabel, quotaLimitKeys } from "./quotaDraft";
import { QuotaDialogKafka } from "./QuotaDialogKafka";

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/**
 * Client quotas: the limits attached to who is calling rather than to what
 * they are calling.
 *
 * Every other page in this app is about a topic or a group. This one is about
 * an identity - a user, an application, an address - and what the cluster will
 * let it do in total. It is the page an operator opens when one client is
 * drowning the others.
 *
 * A quota whose entity has no name is the default that every client of that
 * type inherits, and the board says so in words rather than leaving the cell
 * blank: an empty name and the fallback are different rows on the cluster.
 */
export function QuotasKafka() {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const state = useKafkaQuotas();
  const entityTypes = state.data?.entityTypes ?? [];
  const limitKeys = state.data?.limits ?? [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (state.data?.quotas ?? [])
      .filter((quota): quota is NonNullable<typeof quota> => quota != null)
      .filter((quota) => term === "" || quotaLabel(quota).toLowerCase().includes(term));
  }, [state.data, search]);

  const remove = async (label: string, index: number) => {
    const quota = rows[index];
    if (quota == null) return;
    const ok = await confirm({
      title: t("board.quotas.kafka.deleteTitle", { entity: label }),
      description: t("board.quotas.kafka.deleteBody"),
      confirmLabel: t("board.common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await removeKafkaQuota(
        connID,
        (quota.entity ?? []).filter((one): one is NonNullable<typeof one> => one != null),
        quotaLimitKeys(quota),
      );
      await state.refresh();
      toast.success(t("board.quotas.kafka.deleted", { entity: label }));
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("board.quotas.kafka.title")}
        subtitle={t("board.quotas.kafka.subtitle")}
        actions={
          <>
            <RefreshButton
              refreshing={state.refreshing}
              online={state.online}
              onClick={() => void state.refresh()}
            />
            <Button onClick={() => setCreating(true)}>{t("board.quotas.kafka.newQuota")}</Button>
          </>
        }
      />
      <Toolbar>
        <Input
          className="w-[240px] flex-none"
          placeholder={t("board.quotas.kafka.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="flex-1" />
      </Toolbar>

      <BoardState state={state}>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead>{t("board.quotas.kafka.appliesTo")}</TableHead>
                {limitKeys.map((key) => (
                  <TableHead key={key} style={R}>{key}</TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((quota, index) => {
                const label = quotaLabel(quota);
                return (
                  <TableRow key={label}>
                    <TableCell className="mono3" style={MONO11}>
                      {(quota.entity ?? []).map((one, position) => (
                        <span key={position}>
                          {position > 0 && " · "}
                          {one?.type}=
                          {one?.default ? (
                            <Status tone="off" style={{ fontSize: "10px" }}>
                              {t("board.quotas.kafka.everyone")}
                            </Status>
                          ) : (
                            one?.name
                          )}
                        </span>
                      ))}
                    </TableCell>
                    {limitKeys.map((key) => {
                      const value = quota.limits?.[key];
                      return (
                        <TableCell key={key} className="mono3" style={R}>
                          {/* Absent is not zero: zero throttles a client to
                              nothing, and no limit lets it run. */}
                          {value == null ? (
                            <span style={{ color: "var(--c-muted)" }}>—</span>
                          ) : (
                            formatCount(value)
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell style={R}>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void remove(label, index)}
                      >
                        {t("board.common.delete")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={limitKeys.length + 2}
                    style={{ padding: "18px", color: "var(--c-muted)" }}
                  >
                    {t("board.quotas.kafka.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ListPane>
      </BoardState>

      <QuotaDialogKafka
        open={creating}
        entityTypes={entityTypes}
        limits={limitKeys}
        onClose={() => setCreating(false)}
        onSaved={() => void state.refresh()}
      />
    </Page>
  );
}
