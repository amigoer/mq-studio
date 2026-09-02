import { useCallback } from "react";
import type { Namespace } from "@bindings/model/models";
import * as natsApi from "@/api/nats";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every account on the cluster.
 *
 * Read-only, because NATS has no request that creates one: an account is a
 * block in the server's configuration file or a JWT signed with nsc, and
 * neither is something a connection can ask for.
 *
 * How much of the cluster the figures cover depends on which tier answered.
 * The system account fans out to every server; the monitoring endpoint answers
 * for the one whose port the form named, and the counts are then that server's
 * share. Each row carries which, and the board says so.
 */
export function useNatsAccounts(): BrokerData<Namespace[]> {
  const load = useCallback((connID: number) => natsApi.accounts(connID), []);
  return useBrokerData(load);
}
