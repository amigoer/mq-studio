/**
 * Redis's view of a canonical destination.
 *
 * The keys are a contract with internal/driver/redisstream/destination.go.
 *
 * The readers below return null rather than 0 or "" wherever Redis genuinely
 * did not answer. A stream that has never held an entry has no first entry,
 * and a server that could not be asked for a key's memory has no figure - both
 * are different from a zero, and a board that renders them the same tells the
 * reader something untrue about their broker.
 */
import type { Destination } from "@bindings/model/models";

const AttrLastGeneratedID = "lastGeneratedId";
const AttrFirstEntryID = "firstEntryId";
const AttrLastEntryID = "lastEntryId";
const AttrMaxDeletedEntryID = "maxDeletedEntryId";
const AttrEntriesAdded = "entriesAdded";
const AttrRadixTreeKeys = "radixTreeKeys";
const AttrRadixTreeNodes = "radixTreeNodes";
const AttrMemoryBytes = "memoryBytes";
const AttrGroupNames = "groupNames";

/** The driver's marker for a figure the broker did not report. */
export const UNKNOWN = -1;

function attr(destination: Destination, key: string): string | null {
  const value = destination.attributes?.[key];
  return value == null || value === "" ? null : value;
}

function number(destination: Destination, key: string): number | null {
  const raw = attr(destination, key);
  if (raw == null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? null : value;
}

export const streamKey = (destination: Destination): string => destination.ref.name;

/** XLEN. Always answered, so a stream with none really holds none. */
export const length = (destination: Destination): number => destination.depth;

/** How many consumer groups read it. */
export const groupCount = (destination: Destination): number => destination.subscribers;

/** The group names, which only the detail call pays for. */
export function groupNames(destination: Destination): string[] {
  const raw = attr(destination, AttrGroupNames);
  return raw == null ? [] : raw.split(",").filter((name) => name !== "");
}

export const lastGeneratedId = (destination: Destination): string | null =>
  attr(destination, AttrLastGeneratedID);
export const firstEntryId = (destination: Destination): string | null =>
  attr(destination, AttrFirstEntryID);
export const lastEntryId = (destination: Destination): string | null =>
  attr(destination, AttrLastEntryID);

/**
 * The highest id ever deleted from the stream, when one has been.
 *
 * Absent means nothing has been deleted, which Redis spells 0-0. It matters
 * because it is the one hint that a gap in the ids is deliberate rather than
 * a read that missed something.
 */
export const maxDeletedEntryId = (destination: Destination): string | null =>
  attr(destination, AttrMaxDeletedEntryID);

/**
 * How many entries have ever been added.
 *
 * Not the length: trimming lowers the length and leaves this alone, so the
 * difference between the two is what has been dropped over the stream's life.
 */
export const entriesAdded = (destination: Destination): number | null =>
  number(destination, AttrEntriesAdded);

export const radixTreeKeys = (destination: Destination): number | null =>
  number(destination, AttrRadixTreeKeys);
export const radixTreeNodes = (destination: Destination): number | null =>
  number(destination, AttrRadixTreeNodes);

/** What the key occupies, from MEMORY USAGE. Null when the server refused. */
export const memoryBytes = (destination: Destination): number | null =>
  number(destination, AttrMemoryBytes);

/**
 * How many entries have been trimmed away over the stream's life.
 *
 * Null unless both figures are there: a difference computed from a missing
 * half would be the length itself wearing another name.
 */
export function trimmedAway(destination: Destination): number | null {
  const added = entriesAdded(destination);
  if (added == null) return null;
  const dropped = added - length(destination);
  return dropped > 0 ? dropped : 0;
}
