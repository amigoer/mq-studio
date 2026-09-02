import type { NATSConsumerInput } from "@bindings/bridge/models";
import type { Subscription } from "@bindings/model/models";
import {
  ackPolicy,
  ackWait,
  consumerName,
  deliverGroup,
  deliverPolicy,
  deliverSubject,
  filterSubjects,
  isDurable,
  maxAckPending,
  maxDeliver,
  replayPolicy,
  streamOf,
} from "@/mq/nats/subscriptions";

/** What the consumer dialog collects. */
export interface ConsumerDraft {
  stream: string;
  name: string;
  durable: boolean;
  deliverPolicy: string;
  ackPolicy: string;
  ackWait: string;
  maxDeliver: string;
  maxAckPending: string;
  filterSubject: string;
  replayPolicy: string;
  deliverSubject: string;
  deliverGroup: string;
}

export function emptyConsumerDraft(stream: string): ConsumerDraft {
  return {
    stream,
    name: "",
    // Durable by default, because the other kind disappears the moment
    // nothing is using it - and somebody who wanted that will say so.
    durable: true,
    deliverPolicy: "all",
    ackPolicy: "explicit",
    ackWait: "",
    maxDeliver: "",
    maxAckPending: "",
    filterSubject: "",
    replayPolicy: "instant",
    // Empty is a pull consumer, which is the ordinary case.
    deliverSubject: "",
    deliverGroup: "",
  };
}

export function toConsumerDraft(subscription: Subscription): ConsumerDraft {
  const limit = (value: number | null) => (value == null ? "" : String(value));
  return {
    stream: streamOf(subscription),
    name: consumerName(subscription),
    durable: isDurable(subscription),
    deliverPolicy: deliverPolicy(subscription) ?? "all",
    ackPolicy: ackPolicy(subscription) ?? "explicit",
    ackWait: ackWait(subscription) ?? "",
    maxDeliver: limit(maxDeliver(subscription)),
    maxAckPending: limit(maxAckPending(subscription)),
    filterSubject: filterSubjects(subscription).join(", "),
    replayPolicy: replayPolicy(subscription) ?? "instant",
    deliverSubject: deliverSubject(subscription) ?? "",
    deliverGroup: deliverGroup(subscription) ?? "",
  };
}

/**
 * What is wrong with the draft, or null when it can be submitted.
 *
 * Three checks, and each is something the server's own error would not
 * explain. A consumer name is not a subject; a delivery subject that overlaps
 * the stream's own subjects makes the stream feed itself; and a queue group
 * without a delivery subject is a push setting on a pull consumer, which the
 * server accepts by ignoring.
 */
export function consumerDraftError(draft: ConsumerDraft): string | null {
  if (draft.stream.trim() === "") return "streamRequired";

  const name = draft.name.trim();
  if (name === "") return "nameRequired";
  if (/[.*>\s/\\]/.test(name)) return "nameInvalid";

  for (const subject of splitSubjects(draft.filterSubject)) {
    if (!validSubject(subject)) return "filterInvalid";
  }

  const deliver = draft.deliverSubject.trim();
  if (deliver !== "") {
    // A delivery subject is where the server sends, so a wildcard in it is
    // not a filter - it is an address that cannot be published to.
    if (!validSubject(deliver) || /[*>]/.test(deliver)) return "deliverInvalid";
  } else if (draft.deliverGroup.trim() !== "") {
    return "groupNeedsDeliver";
  }
  return null;
}

export function splitSubjects(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((subject) => subject.trim())
    .filter((subject) => subject !== "");
}

function validSubject(subject: string): boolean {
  const tokens = subject.split(".");
  return tokens.every((token, index) => {
    if (token === "") return false;
    if (token === ">") return index === tokens.length - 1;
    if (token === "*") return true;
    return !/[*>]/.test(token);
  });
}

export function toConsumerInput(draft: ConsumerDraft): NATSConsumerInput {
  const push = draft.deliverSubject.trim() !== "";
  return {
    stream: draft.stream.trim(),
    name: draft.name.trim(),
    durable: draft.durable,
    deliverPolicy: draft.deliverPolicy,
    ackPolicy: draft.ackPolicy,
    ackWait: draft.ackWait.trim(),
    maxDeliver: draft.maxDeliver.trim(),
    maxAckPending: draft.maxAckPending.trim(),
    filterSubject: splitSubjects(draft.filterSubject).join(","),
    replayPolicy: draft.replayPolicy,
    deliverSubject: push ? draft.deliverSubject.trim() : "",
    // A queue group only means anything alongside a delivery subject, and
    // sending one without would store a setting the server ignores.
    deliverGroup: push ? draft.deliverGroup.trim() : "",
  } as NATSConsumerInput;
}
