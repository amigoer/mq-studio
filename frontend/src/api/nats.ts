import { NATSService } from "@bindings/bridge";
import type {
  NATSConsumerInput,
  NATSPublishInput,
  NATSSubscribeInput,
  PurgeInput,
  StreamInput,
} from "@bindings/bridge/models";
import type {
  BrokerCensus,
  BrokerHealth,
  ClientConnection,
  LiveBatch,
  LiveSubscription,
  Namespace,
} from "@bindings/model/models";
import type { AccountUsage } from "@bindings/driver/nats/models";
import type { PublishResult } from "@bindings/driver/nats/models";
import type { TrimResult } from "@bindings/model/models";
import { present, required } from "./client";

export type { NATSConsumerInput, NATSPublishInput, NATSSubscribeInput, PurgeInput, StreamInput };

/**
 * The NATS-only half of the surface.
 *
 * Reading streams is not here: a stream is a destination, and api/topic.ts
 * already answers the whole read side. What this carries is the writing, which
 * the canonical service cannot express - its create collects a broker address,
 * a read queue, a write queue and a permission mask, and a JetStream stream
 * has none of those.
 */

/** Declares a stream. Refused if one of that name already exists. */
export const createStream = (connID: number, input: StreamInput): Promise<void> =>
  NATSService.CreateStream(connID, input);

/**
 * Rewrites an existing stream's configuration.
 *
 * Separate from the create rather than one idempotent call: a create that
 * quietly became an update would rewrite another application's subjects, and
 * an update that quietly became a create would hide a stream somebody had
 * deleted underneath the page.
 */
export const updateStream = (connID: number, input: StreamInput): Promise<void> =>
  NATSService.UpdateStream(connID, input);

/** Removes a stream and every message in it. */
export const deleteStream = (connID: number, name: string): Promise<void> =>
  NATSService.DeleteStream(connID, name);

/**
 * Discards messages from the head of a stream.
 *
 * The count that comes back is the report rather than a formality: it is the
 * only way to tell a bound that already held from one that matched nothing at
 * all, and those look identical on the page.
 */
export const purgeStream = (connID: number, input: PurgeInput): Promise<TrimResult> =>
  NATSService.PurgeStream(connID, input).then(required);

/** Removes messages by sequence, and reports how many were there to remove. */
export const deleteMessages = (
  connID: number,
  stream: string,
  sequences: string[],
): Promise<TrimResult> => NATSService.DeleteMessages(connID, stream, sequences).then(required);

/** Declares a consumer on a stream. Refused if one of that name exists. */
export const createConsumer = (connID: number, input: NATSConsumerInput): Promise<void> =>
  NATSService.CreateConsumer(connID, input);

/**
 * Rewrites an existing consumer's configuration.
 *
 * Not where it reads from: the server refuses to change a consumer's delivery
 * policy after it exists, which is why there is no reset-position call here at
 * all.
 */
export const updateConsumer = (connID: number, input: NATSConsumerInput): Promise<void> =>
  NATSService.UpdateConsumer(connID, input);

/** Removes a consumer and the position it held. */
export const deleteConsumer = (connID: number, stream: string, name: string): Promise<void> =>
  NATSService.DeleteConsumer(connID, stream, name);

/**
 * Sends a message on a subject.
 *
 * What comes back says which kind of send it was. A core publish reports how
 * many went out and no acknowledgement, because NATS has none to give; a
 * stored one names the stream and sequence it landed at; a request carries the
 * answer, and says whether there was one at all.
 */
export const publish = (connID: number, input: NATSPublishInput): Promise<PublishResult> =>
  NATSService.Publish(connID, input).then(required);

/**
 * Begins following one or more subjects.
 *
 * The subscription is real on the server until it is stopped, so whoever
 * starts one owns ending it. Closing the connection ends every one.
 */
export const startSubscription = (
  connID: number,
  input: NATSSubscribeInput,
): Promise<LiveSubscription> => NATSService.StartSubscription(connID, input).then(required);

/** Drains what has arrived since the cursor. */
export const pollSubscription = (
  connID: number,
  id: string,
  after: number,
  limit: number,
): Promise<LiveBatch> => NATSService.PollSubscription(connID, id, after, limit).then(required);

/** Ends one. Not optional cleanup. */
export const stopSubscription = (connID: number, id: string): Promise<void> =>
  NATSService.StopSubscription(connID, id);

/** What is running, so a panel that remounts finds its own stream again. */
export const subscriptions = (connID: number): Promise<LiveSubscription[]> =>
  NATSService.Subscriptions(connID).then(present);

/** Counts what the account holds, in one request. */
export const census = (connID: number): Promise<BrokerCensus> =>
  NATSService.Census(connID).then(required);

/**
 * Runs the server's own health checks.
 *
 * Three of them, because /healthz answers a different question per set of
 * parameters: a server can be up and serving core NATS perfectly while its
 * JetStream assets are still being recovered.
 */
export const health = (connID: number): Promise<BrokerHealth> =>
  NATSService.Health(connID).then(required);

/**
 * Reads the account's JetStream meters, limits included.
 *
 * The limits come with the usage because a meter needs both, and -1 is how the
 * server spells "no cap" - a bar drawn against it can never move.
 */
export const usage = (connID: number): Promise<AccountUsage> =>
  NATSService.Usage(connID).then(required);

/**
 * The connections the cluster is holding.
 *
 * Here rather than on a canonical service because there is none: client
 * inspection has never had one, and MQTT and RabbitMQ each expose their own
 * for the same reason.
 */
export const connections = (connID: number, account: string): Promise<ClientConnection[]> =>
  NATSService.Connections(connID, account).then(present);

/**
 * Disconnects one client.
 *
 * The name is the server holding it and its client id joined - neither half
 * addresses a connection on its own, because a client id counts within one
 * server.
 */
export const closeConnection = (connID: number, name: string, reason: string): Promise<void> =>
  NATSService.CloseConnection(connID, name, reason);

/** Closes every connection one identity holds. */
export const closeUserConnections = (
  connID: number,
  user: string,
  reason: string,
): Promise<void> => NATSService.CloseUserConnections(connID, user, reason);

/**
 * The accounts on the cluster.
 *
 * Read-only: nothing in NATS creates an account over a connection, so there is
 * no write half of this to expose.
 */
export const accounts = (connID: number): Promise<Namespace[]> =>
  NATSService.Accounts(connID).then(present);
