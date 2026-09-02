import type { NATSPublishInput } from "@bindings/bridge/models";

/** What the NATS send console collects. */
export interface ProducerDraft {
  subject: string;
  payload: string;
  /** Headers as typed, one "name: value" per line. */
  headers: string;
  count: string;
  /** Wait for a stream to say it stored the message. */
  persist: boolean;
  expectStream: string;
  deduplicationId: string;
  /** Turn the send into a request and wait this long, in milliseconds. */
  replyTimeoutMs: string;
}

export function emptyProducerDraft(): ProducerDraft {
  return {
    subject: "",
    payload: "",
    headers: "",
    count: "1",
    // Off by default, because most NATS subjects have no stream behind them
    // and a send that failed for asking to be stored would be the wrong first
    // experience of the page.
    persist: false,
    expectStream: "",
    deduplicationId: "",
    replyTimeoutMs: "",
  };
}

/**
 * What is wrong with the draft, or null when it can be sent.
 *
 * The wildcard check is the one that matters. A subject with a wildcard is a
 * pattern to subscribe to, not an address to publish on: the server accepts
 * it, matches nothing, and reports success - so the message goes to nobody, is
 * stored by no stream, and the console says it worked.
 */
export function producerDraftError(draft: ProducerDraft): string | null {
  const subject = draft.subject.trim();
  if (subject === "") return "subjectRequired";
  if (/[*>]/.test(subject)) return "subjectIsPattern";
  if (/[\s]/.test(subject)) return "subjectInvalid";
  if (subject.split(".").some((token) => token === "")) return "subjectInvalid";

  const count = Number.parseInt(draft.count.trim(), 10);
  if (Number.isNaN(count) || count < 1 || count > 1000) return "countInvalid";

  const wait = draft.replyTimeoutMs.trim();
  if (wait !== "") {
    const parsed = Number.parseInt(wait, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return "waitInvalid";
    // A request expects one answer, so repeating it means nothing.
    if (count > 1) return "requestCannotRepeat";
  }

  // A stream to expect only means anything on a stored send: the server checks
  // it while storing, and there is nothing to check on a core publish.
  if (!draft.persist && draft.expectStream.trim() !== "") return "expectNeedsPersist";
  if (!draft.persist && draft.deduplicationId.trim() !== "") return "dedupNeedsPersist";

  if (parseHeaders(draft.headers) == null) return "headersInvalid";
  return null;
}

/**
 * Reads the headers box, or null when a line is not a header.
 *
 * One "name: value" per line, because that is how somebody who has read a NATS
 * message writes them down. A blank line is skipped rather than refused.
 */
export function parseHeaders(raw: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    const colon = text.indexOf(":");
    if (colon <= 0) return null;
    const name = text.slice(0, colon).trim();
    if (name === "") return null;
    headers[name] = text.slice(colon + 1).trim();
  }
  return headers;
}

export function toPublishInput(draft: ProducerDraft): NATSPublishInput {
  const persist = draft.persist;
  return {
    subject: draft.subject.trim(),
    payload: draft.payload,
    headers: parseHeaders(draft.headers) ?? {},
    count: Number.parseInt(draft.count.trim(), 10),
    persist,
    // Dropped rather than sent on a core publish: there is nothing for the
    // server to check, and storing them would show settings back as if they
    // were in force.
    expectStream: persist ? draft.expectStream.trim() : "",
    deduplicationId: persist ? draft.deduplicationId.trim() : "",
    replyTimeoutMs:
      draft.replyTimeoutMs.trim() === "" ? 0 : Number.parseInt(draft.replyTimeoutMs.trim(), 10),
  } as NATSPublishInput;
}
