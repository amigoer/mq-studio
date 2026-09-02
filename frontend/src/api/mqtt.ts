import { MQTTService } from "@bindings/bridge";
import type { MQTTPublishInput, MQTTSubscribeInput } from "@bindings/bridge/models";
import type { ClientSubscription, PublishResult } from "@bindings/driver/mqtt/models";
import type { ClientConnection, LiveBatch, LiveSubscription } from "@bindings/model/models";
import { present, required } from "./client";

export type { ClientSubscription, MQTTPublishInput, MQTTSubscribeInput, PublishResult };

/**
 * The MQTT-only surface.
 *
 * Reading retained topics and the broker's nodes is not here: those are
 * destinations and nodes, and api/topic.ts and api/cluster.ts already answer
 * them for every family. Connected clients are here despite being a canonical
 * model, because client inspection has no canonical service to be read from -
 * RabbitMQ exposes its own the same way.
 */

/** Who the broker is holding a session for. Needs a management API. */
export const getMqttClients = (connID: number): Promise<ClientConnection[]> =>
  MQTTService.Clients(connID).then(present);

/**
 * Ends one client's session.
 *
 * No reason argument, because MQTT has nowhere to put one: the broker sends a
 * reason code and no text, so a reason typed here would go nowhere and leave
 * the operator believing the client was told why.
 */
export const kickMqttClient = (connID: number, clientID: string): Promise<void> =>
  MQTTService.KickClient(connID, clientID);

/** Ends every session a username holds. */
export const kickMqttUser = (connID: number, username: string): Promise<void> =>
  MQTTService.KickUser(connID, username);

/**
 * Publishes with everything MQTT can carry.
 *
 * Separate from the canonical publish because that one is AMQP-shaped: it
 * carries an exchange, a routing key and a mandatory flag that MQTT has no
 * counterpart for, and has nowhere to put QoS, the retain flag or the 5.0
 * properties, which are most of what an MQTT publish is.
 */
export const publishMqtt = (connID: number, input: MQTTPublishInput): Promise<PublishResult> =>
  MQTTService.Publish(connID, input).then(required);

/**
 * Opens a live stream and starts buffering it on the Go side.
 *
 * The stream outlives this call: it is a real subscription on the broker until
 * stopSubscription ends it, so a panel that unmounts without stopping leaves
 * the session receiving traffic nobody reads.
 */
export const startMqttSubscription = (
  connID: number,
  input: MQTTSubscribeInput,
): Promise<LiveSubscription> => MQTTService.StartSubscription(connID, input).then(required);

/**
 * Drains what arrived after the caller's last sequence.
 *
 * A poll rather than a push. The buffer is bounded, so the batch reports how
 * many messages it had to drop: a stream that is quietly losing and one that
 * is quiet look identical without it.
 */
export const pollMqttSubscription = (
  connID: number,
  id: string,
  after: number,
  limit: number,
): Promise<LiveBatch> => MQTTService.PollSubscription(connID, id, after, limit).then(required);

/** Ends a stream and unsubscribes on the broker. */
export const stopMqttSubscription = (connID: number, id: string): Promise<void> =>
  MQTTService.StopSubscription(connID, id);

/** What this connection is currently streaming. */
export const getMqttSubscriptions = (connID: number): Promise<LiveSubscription[]> =>
  MQTTService.Subscriptions(connID).then(present);

/** The topic filters one client holds, from the broker's management API. */
export const getMqttClientSubscriptions = (
  connID: number,
  clientID: string,
): Promise<ClientSubscription[]> =>
  MQTTService.ClientSubscriptions(connID, clientID).then(present);

/** Every filter the broker is holding, across clients. */
export const getMqttBrokerSubscriptions = (connID: number): Promise<ClientSubscription[]> =>
  MQTTService.BrokerSubscriptions(connID).then(present);
