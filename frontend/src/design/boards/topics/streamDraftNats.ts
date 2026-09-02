import type { StreamInput } from "@/api/nats";
import type { Destination } from "@bindings/model/models";
import {
  compression,
  denyDelete,
  denyPurge,
  allowRollup,
  description,
  discard,
  duplicateWindow,
  maxAge,
  maxBytes,
  maxMessages,
  maxMessageSize,
  maxMessagesPerSubject,
  replicas,
  retention,
  storage,
  streamName,
  subjects,
} from "@/mq/nats/destinations";

/**
 * What the stream dialog collects.
 *
 * The limits are strings rather than numbers so that "left blank" and "set to
 * zero" stay different all the way to the driver. -1 is how the server spells
 * no limit and 0 means a stream that can hold nothing; a numeric input that
 * arrived empty would have to pick one of those on the user's behalf, and
 * either choice would be wrong half the time.
 */
export interface StreamDraft {
  name: string;
  description: string;
  subjects: string;
  retention: string;
  storage: string;
  discard: string;
  replicas: number;
  maxMsgs: string;
  maxBytes: string;
  maxMsgsPerSubject: string;
  maxMsgSize: string;
  maxAge: string;
  duplicateWindow: string;
  compression: string;
  denyDelete: boolean;
  denyPurge: boolean;
  allowRollup: boolean;
}

export function emptyStreamDraft(): StreamDraft {
  return {
    name: "",
    description: "",
    subjects: "",
    // The server's own defaults, so a form nobody touched declares the stream
    // the server would have declared.
    retention: "limits",
    storage: "file",
    discard: "old",
    replicas: 1,
    maxMsgs: "",
    maxBytes: "",
    maxMsgsPerSubject: "",
    maxMsgSize: "",
    maxAge: "",
    duplicateWindow: "",
    compression: "none",
    denyDelete: false,
    denyPurge: false,
    allowRollup: false,
  };
}

/**
 * Reads an existing stream back into the form.
 *
 * The limits come back as numbers or null, and null is the server's no-limit
 * spelling - which has to become a blank field, not a "-1" the user would then
 * have to know the meaning of.
 */
export function toStreamDraft(stream: Destination): StreamDraft {
  const limit = (value: number | null) => (value == null ? "" : String(value));
  return {
    name: streamName(stream),
    description: description(stream) ?? "",
    subjects: subjects(stream).join(", "),
    retention: retention(stream) ?? "limits",
    storage: storage(stream) ?? "file",
    discard: discard(stream) ?? "old",
    replicas: replicas(stream) ?? 1,
    maxMsgs: limit(maxMessages(stream)),
    maxBytes: limit(maxBytes(stream)),
    maxMsgsPerSubject: limit(maxMessagesPerSubject(stream)),
    maxMsgSize: limit(maxMessageSize(stream)),
    maxAge: maxAge(stream) ?? "",
    duplicateWindow: duplicateWindow(stream) ?? "",
    compression: compression(stream) ?? "none",
    denyDelete: denyDelete(stream),
    denyPurge: denyPurge(stream),
    allowRollup: allowRollup(stream),
  };
}

/**
 * What is wrong with the draft, or null when it can be submitted.
 *
 * The two checks here are the two the server's own errors do not explain. A
 * stream name is not a subject, and the commonest mistake is pasting one in -
 * the server answers "invalid stream name", which leaves somebody staring at
 * something that looks fine. And a > matches the rest of a subject, so
 * anywhere but the end it silently matches nothing and the stream sits there
 * collecting no messages with nothing on screen to say why.
 *
 * Everything else is left to the server on purpose: a rule copied into the
 * client is a rule that goes stale a release later.
 */
export function streamDraftError(draft: StreamDraft): string | null {
  const name = draft.name.trim();
  if (name === "") return "nameRequired";
  if (/[.*>\s/\\]/.test(name)) return "nameInvalid";

  const list = splitSubjects(draft.subjects);
  if (list.length === 0) return "subjectsRequired";
  for (const subject of list) {
    if (!validSubject(subject)) return "subjectInvalid";
  }

  if (draft.replicas < 1) return "replicasInvalid";
  // A replica count has to be odd for the Raft group to elect a leader, and
  // the server caps it at five. Two replicas is the trap: it looks safer than
  // one and cannot survive losing either.
  if (draft.replicas > 5) return "replicasInvalid";
  return null;
}

/** Splits the subject field however the user separated it. */
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

/** The draft as the bridge takes it, with the name trimmed and nothing else. */
export function toStreamInput(draft: StreamDraft): StreamInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    subjects: splitSubjects(draft.subjects).join(","),
    retention: draft.retention,
    storage: draft.storage,
    discard: draft.discard,
    replicas: draft.replicas,
    maxMsgs: draft.maxMsgs.trim(),
    maxBytes: draft.maxBytes.trim(),
    maxMsgsPerSubject: draft.maxMsgsPerSubject.trim(),
    maxMsgSize: draft.maxMsgSize.trim(),
    maxAge: draft.maxAge.trim(),
    duplicateWindow: draft.duplicateWindow.trim(),
    compression: draft.compression,
    denyDelete: draft.denyDelete,
    denyPurge: draft.denyPurge,
    allowRollup: draft.allowRollup,
  } as StreamInput;
}
