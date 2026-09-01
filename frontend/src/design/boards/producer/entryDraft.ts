/**
 * What the Redis send console collects, and what it sends.
 *
 * It lives beside the board rather than inside it because the rules are the
 * part worth testing: an entry with no usable field is refused by the server,
 * an explicit id has to be an id, and a count and an explicit id cannot be
 * combined - each copy needs its own id.
 */
import type { EntryDraft, EntryField } from "@/api/redis";

export interface EntryForm {
  stream: string;
  fields: EntryField[];
  /** Kept as text: an empty field means "let the server assign one". */
  id: string;
  /** Kept as text so an empty box is not a zero. */
  count: string;
}

export function emptyEntryDraft(stream: string): EntryForm {
  return {
    stream,
    fields: [{ name: "", value: "" }],
    id: "",
    count: "1",
  };
}

/** The fields that will actually be written: a row with no name is not one. */
export function usableFields(form: EntryForm): EntryField[] {
  return form.fields.filter((field) => field.name.trim() !== "");
}

/**
 * What the form asks for, or the reason it cannot be sent.
 *
 * An abandoned row is dropped rather than refused - someone who clicked "add
 * field" and changed their mind should not have to tidy up - but an entry with
 * nothing named at all is refused, because Redis will not store one.
 */
export function validate(form: EntryForm, t: (key: string) => string): string | null {
  if (form.stream.trim() === "") return t("board.producer.redis.streamRequired");
  if (usableFields(form).length === 0) return t("board.producer.redis.fieldRequired");

  const count = form.count.trim();
  if (count === "") return t("board.producer.redis.countRequired");
  // Digits, not Number(): "1e4" is an integer as far as Number.isInteger is
  // concerned, and a send is not something to guess the size of.
  if (!/^\d+$/.test(count) || Number(count) < 1) {
    return t("board.producer.redis.countInvalid");
  }

  const id = form.id.trim();
  if (id === "") return null;
  if (!/^\d+(-\d+)?$/.test(id)) return t("board.producer.redis.idInvalid");
  // An explicit id can only be used once, so a second copy would fail having
  // already written the first. Saying so here leaves the stream untouched.
  if (Number(count) > 1) return t("board.producer.redis.idWithCount");
  return null;
}

export function toDraft(form: EntryForm): EntryDraft {
  return {
    stream: form.stream.trim(),
    // Trimmed names, untrimmed values: a name with a space is a different
    // field and almost certainly a slip, but whitespace inside a value may be
    // exactly what the producer meant to send.
    fields: usableFields(form).map((field) => ({
      name: field.name.trim(),
      value: field.value,
    })),
    id: form.id.trim(),
    count: Number(form.count.trim()),
  };
}
