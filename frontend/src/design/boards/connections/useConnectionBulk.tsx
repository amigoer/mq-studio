import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm, useToast } from "@/components";
import { Badge } from "@/components/ui/badge";
import type { Connection } from "@/design/data/connections";
import { ProtocolIcon } from "@/design/icons/ProtocolIcon";
import { useConnectionProfiles } from "@/hooks/useConnectionProfiles";
import { formatErrorMessage } from "@/lib/utils";
import { bulkTargets, deletePlan, type BulkAction } from "./connectionSelection";

/** A bulk action under way: what it takes, in order, and how far it has got. */
export type BulkRun = {
  action: BulkAction;
  keys: readonly string[];
  /** How many have finished; the one at this index is in flight. */
  done: number;
  stopping: boolean;
};

/** How many names the delete confirmation spells out before it counts the rest. */
const NAMED = 6;

type Failure = { name: string; error: string };

/**
 * Runs one action over several connections, one connection at a time.
 *
 * Not caution: Go takes every dial, test and delete under a single runtime
 * lock, so sending them together only queues them there - and every queued
 * dial would then report its wait for the lock as the connection's latency.
 *
 * It lives above the list, so a run keeps reporting its progress when the list
 * is left and come back to.
 */
export function useConnectionBulk(onGone: (keys: readonly string[]) => void) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const profiles = useConnectionProfiles();
  const [run, setRun] = useState<BulkRun | null>(null);
  const busy = useRef(false);
  const stopRequested = useRef(false);

  // A run outlives the render that started it, so it reads state through this.
  const latest = useRef({ profiles, onGone });
  useEffect(() => {
    latest.current = { profiles, onGone };
  });

  const settle = async (action: BulkAction, connection: Connection): Promise<string | undefined> => {
    const { connect, disconnect, test, remove } = latest.current.profiles;
    if (action === "delete") {
      try {
        await remove(connection.id);
        return undefined;
      } catch (error) {
        return formatErrorMessage(error);
      }
    }
    const dial = action === "connect" ? connect : action === "disconnect" ? disconnect : test;
    const result = await dial(connection.id);
    return result.ok ? undefined : result.error;
  };

  const confirmDelete = (order: readonly Connection[], kept: Connection | undefined) =>
    confirm({
      title: t("page.connections.bulk.deleteTitle", { count: order.length }),
      description: (
        <>
          {t("page.connections.bulk.deleteDesc")}
          <span className="mt-3 flex flex-wrap items-center gap-1.5">
            {order.slice(0, NAMED).map((c) => (
              <Badge key={c.key} variant="outline" className="rounded px-1.5 font-normal">
                {c.protocol != null && <ProtocolIcon protocol={c.protocol} className="" />}
                {c.name}
              </Badge>
            ))}
            {order.length > NAMED && (
              <span className="text-xs">
                {t("page.connections.bulk.andMore", { count: order.length - NAMED })}
              </span>
            )}
          </span>
          {kept != null && (
            <span className="mt-3 block">
              {t("page.connections.bulk.defaultKept", { name: kept.name })}
            </span>
          )}
        </>
      ),
      confirmLabel: t("page.connections.deleteAction"),
      danger: true,
    });

  const report = (action: BulkAction, succeeded: number, failures: Failure[], left: number) => {
    const stopped = left > 0 ? t("page.connections.bulk.stopped", { count: left }) : undefined;
    const first = failures[0];
    if (first != null) {
      toast.error(
        t(`page.connections.bulk.failed.${action}`, {
          failed: failures.length,
          total: succeeded + failures.length,
        }),
        { description: t("page.connections.bulk.failure", { name: first.name, error: first.error }) },
      );
    } else if (succeeded > 0) {
      toast.success(t(`page.connections.bulk.done.${action}`, { count: succeeded }), {
        description: stopped,
      });
    } else if (stopped != null) {
      toast.info(stopped);
    }
  };

  const runAll = async (action: BulkAction, order: readonly Connection[]) => {
    stopRequested.current = false;
    setRun({ action, keys: order.map((c) => c.key), done: 0, stopping: false });
    let done = 0;
    let succeeded = 0;
    const failures: Failure[] = [];
    try {
      for (const queued of order) {
        if (stopRequested.current) break;
        const { profiles: now, onGone: gone } = latest.current;
        const connection = now.connections.find((c) => c.key === queued.key);
        // Deleted, or dialled from its own row, while it waited for its turn.
        if (connection != null && bulkTargets(action, [connection], now.pending).length > 0) {
          const error = await settle(action, connection);
          if (error != null) {
            failures.push({ name: connection.name, error });
          } else {
            succeeded += 1;
            // A tab on a connection that is closed or gone has nothing left to show.
            if (action === "disconnect" || action === "delete") gone([connection.key]);
          }
        }
        done += 1;
        setRun((current) => current && { ...current, done });
      }
    } finally {
      setRun(null);
    }
    report(action, succeeded, failures, order.length - done);
  };

  const start = async (action: BulkAction, selection: readonly Connection[]) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const { connections, pending } = latest.current.profiles;
      let order = bulkTargets(action, selection, pending);
      if (action === "delete") {
        const plan = deletePlan(order, connections.length);
        if (plan.order.length === 0) {
          if (plan.kept != null) {
            toast.error(t("page.connections.bulk.defaultKept", { name: plan.kept.name }));
          }
          return;
        }
        if (!(await confirmDelete(plan.order, plan.kept))) return;
        order = plan.order;
      }
      if (order.length > 0) await runAll(action, order);
    } finally {
      busy.current = false;
    }
  };

  /** Lets the connection in flight finish; nothing after it is started. */
  const stop = () => {
    stopRequested.current = true;
    setRun((current) => current && { ...current, stopping: true });
  };

  return { run, start, stop };
}
