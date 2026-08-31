import { useCallback } from "react";
import type { Identity, TopicPermission } from "@/api/rabbitmq";
import * as rabbitApi from "@/api/rabbitmq";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface IdentitySnapshot {
  identities: Identity[];
  topicPermissions: TopicPermission[];
}

/**
 * Users, their permissions and the topic narrowing on top.
 *
 * Read together because the third only means anything beside the second: a
 * topic permission is a filter over a namespace permission, and a user with no
 * write permission gains none from a topic permission that would allow it.
 */
export function useRabbitIdentities(): BrokerData<IdentitySnapshot> {
  const load = useCallback(async (connID: number): Promise<IdentitySnapshot> => {
    const [identities, topicPermissions] = await Promise.all([
      rabbitApi.getIdentities(connID),
      // Best effort: an older broker or a user without permission to read them
      // should still see the user list.
      rabbitApi.getTopicPermissions(connID).catch(() => [] as TopicPermission[]),
    ]);
    return { identities, topicPermissions };
  }, []);
  return useBrokerData(load);
}
