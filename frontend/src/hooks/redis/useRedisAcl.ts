import { useCallback } from "react";
import type { AclUser } from "@/api/models";
import * as redisApi from "@/api/redis";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface RedisAcl {
  users: AclUser[];
  /** The command groups rules are written in terms of, as the server lists them. */
  categories: string[];
}

/**
 * The server's users and the categories their rules are written in.
 *
 * Both at once because the form needs the second to offer anything: the
 * category list differs by server version, so a fixed one would offer groups a
 * server does not have and omit the ones it added.
 */
export function useRedisAcl(): BrokerData<RedisAcl> {
  const load = useCallback(async (connID: number): Promise<RedisAcl> => {
    const [users, categories] = await Promise.all([
      redisApi.aclUsers(connID),
      redisApi.aclCategories(connID).catch(() => [] as string[]),
    ]);
    return { users, categories };
  }, []);
  return useBrokerData(load);
}
