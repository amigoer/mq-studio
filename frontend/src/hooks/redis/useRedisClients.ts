import { useCallback } from "react";
import type { ClientConnection } from "@/api/models";
import * as redisApi from "@/api/redis";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

/**
 * Every connection open against the server.
 *
 * It refreshes on the shared interval like every other list. A connection page
 * that did not would show sockets that closed minutes ago, and the whole
 * reason to open it is to see what is holding one now.
 */
export function useRedisClients(): BrokerData<ClientConnection[]> {
  const load = useCallback((connID: number) => redisApi.clientConnections(connID), []);
  return useBrokerData(load);
}
