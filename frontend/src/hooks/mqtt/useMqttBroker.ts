import { useCallback } from "react";
import { getClusterView } from "@/api/cluster";
import { getTopics } from "@/api/topic";
import {
  getMqttBrokerSubscriptions,
  getMqttClients,
  type ClientSubscription,
} from "@/api/mqtt";
import type { ClientConnection, ClusterOverview, Destination, Node } from "@/api/models";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";
import { useConnectionProfiles } from "@/hooks/useConnectionProfiles";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { OPTION_MQTT_PROTOCOL } from "@/design/boards/connections/ConnectionForms";

export interface MqttBroker {
  overview: ClusterOverview;
  nodes: Node[];
}

/**
 * The broker snapshot the overview and cluster boards read.
 *
 * One request, because both halves come from the same source whichever tier
 * answered: on a Mosquitto it is one $SYS read, and on an EMQX it is the
 * management API. Splitting them would mean two reads that could disagree.
 */
export function useMqttBroker(): BrokerData<MqttBroker> {
  return useBrokerData(
    useCallback(
      (connID: number) =>
        getClusterView(connID).then((view) => ({
          overview: view.overview,
          nodes: (view.nodes ?? []).filter((node): node is Node => node != null),
        })),
      [],
    ),
  );
}

/**
 * The topics that hold a retained value.
 *
 * Not a cheap read: it subscribes to everything, waits for the broker to
 * replay its retained set, and unsubscribes. That is the only way MQTT can
 * answer the question at all, and it is why the board asks for it rather than
 * polling it.
 */
export function useMqttTopics(): BrokerData<Destination[]> {
  return useBrokerData(
    useCallback(
      (connID: number) => getTopics(connID),
      [],
    ),
  );
}

/** Who the broker is holding a session for. Needs a management API. */
export function useMqttClients(): BrokerData<ClientConnection[]> {
  return useBrokerData(
    useCallback(
      (connID: number) => getMqttClients(connID),
      [],
    ),
  );
}

/** Every topic filter the broker is holding, across clients. */
export function useMqttSubscriptions(enabled: boolean): BrokerData<ClientSubscription[]> {
  return useBrokerData(
    useCallback((connID: number) => getMqttBrokerSubscriptions(connID), []),
    { enabled },
  );
}

/**
 * Whether this connection speaks MQTT 5.0.
 *
 * Not a capability: both versions can publish and subscribe, and what differs
 * is what a message can carry - reason codes, user properties, message expiry
 * and shared subscriptions are 5.0 only. The send console needs it to refuse
 * those fields before a round trip rather than after one, so it is read off
 * the stored profile rather than probed.
 */
export function useMqttProtocolIsFive(): boolean {
  const { id } = useConnectionScope();
  const { profiles } = useConnectionProfiles();
  const profile = profiles.find((candidate) => candidate.id === id);
  // Unset means 5.0, which is what the form defaults to and what a profile
  // written before the field existed would have meant.
  return profile?.options?.[OPTION_MQTT_PROTOCOL] !== "311";
}
