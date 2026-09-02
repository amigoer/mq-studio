import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Segmented, SelectField } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { GroupStart } from "@/api/redis";

export interface GroupForm {
  stream: string;
  group: string;
  start: GroupStart;
}

export function emptyGroupForm(stream: string): GroupForm {
  return {
    stream,
    group: "",
    // The end of the stream. It is the answer that cannot go wrong loudly: a
    // group created here sees what arrives next and nothing else, where one
    // created at the beginning replays the whole stream into whatever attaches.
    start: "$",
  };
}

/**
 * What the form asks for, or the reason it cannot be submitted.
 *
 * A group name is unique only within its stream, so both halves are required.
 * There is no server-side default for either.
 */
export function validate(form: GroupForm, t: (key: string) => string): string | null {
  if (form.stream.trim() === "") return t("board.consumers.redis.streamRequired");
  if (form.group.trim() === "") return t("board.consumers.redis.groupRequired");
  return null;
}

/**
 * Declaring a consumer group.
 *
 * The whole decision is where it starts, and both answers are consequential in
 * opposite directions - so the dialog says what each one does rather than
 * offering two letters. Neither is reversible without repositioning the group
 * afterwards.
 */
export function GroupDialog({
  open,
  streams,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  streams: string[];
  onOpenChange: (open: boolean) => void;
  onCreate: (stream: string, group: string, start: GroupStart) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<GroupForm>(emptyGroupForm(streams[0] ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyGroupForm(streams[0] ?? ""));
      setError(null);
    }
  }, [open, streams]);

  const set = <K extends keyof GroupForm>(key: K, next: GroupForm[K]) =>
    setForm((current) => ({ ...current, [key]: next }));

  const invalid = validate(form, t);

  const submit = async () => {
    if (invalid != null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(form.stream.trim(), form.group.trim(), form.start);
      onOpenChange(false);
    } catch (createError) {
      setError(formatErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("board.consumers.redis.newGroup")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Stream</FieldLabel>
            <SelectField
              value={form.stream}
              onValueChange={(next: string) => set("stream", next)}
              options={streams.map((stream) => ({ value: stream }))}
            />
            <FieldDescription>{t("board.consumers.redis.streamHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="redis-group-name">{t("board.common.group")}</FieldLabel>
            <Input
              id="redis-group-name"
              className="mono3"
              value={form.group}
              placeholder="settle-group"
              onChange={(event) => set("group", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.redis.startAt")}</FieldLabel>
            <Segmented
              style={{ alignSelf: "flex-start" }}
              value={form.start}
              onChange={(next: GroupStart) => set("start", next)}
              options={[
                { value: "$", label: t("board.consumers.redis.startNow") },
                { value: "0", label: t("board.consumers.redis.startBeginning") },
              ]}
            />
            <FieldDescription>
              {form.start === "$"
                ? t("board.consumers.redis.startNowHint")
                : t("board.consumers.redis.startBeginningHint")}
            </FieldDescription>
          </Field>

          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button disabled={invalid != null || busy} title={invalid ?? undefined} onClick={() => void submit()}>
            {busy && <Spinner className="size-3.5" />}
            {t("board.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
