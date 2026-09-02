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
import { Segmented } from "@/components";
import { formatErrorMessage } from "@/lib/utils";

/** Where a reposition moves a group to. */
export type PositionChoice = "beginning" | "end" | "entry";

export interface PositionForm {
  choice: PositionChoice;
  /** Only read when the choice is an explicit entry. */
  entryId: string;
}

export function emptyPositionForm(): PositionForm {
  return { choice: "beginning", entryId: "" };
}

/**
 * The position the form submits, as Redis spells it.
 *
 * "0" is the beginning of what the stream still holds rather than of what it
 * ever held: entries trimmed away do not come back, so a group moved here
 * replays only what survives.
 */
export function toPosition(form: PositionForm): string {
  switch (form.choice) {
    case "beginning":
      return "0";
    case "end":
      return "$";
    default:
      return form.entryId.trim();
  }
}

/**
 * What the form asks for, or the reason it cannot be submitted.
 *
 * The id is checked here as well as in the driver. Both are worth having: this
 * one runs while the field is still in front of the user, and a reposition
 * refused by the server after the dialog closed reads like a failure of the
 * button rather than of the value.
 */
export function validate(form: PositionForm, t: (key: string) => string): string | null {
  if (form.choice !== "entry") return null;
  const id = form.entryId.trim();
  if (id === "") return t("board.consumers.redis.position.idRequired");
  if (!/^\d+(-\d+)?$/.test(id)) return t("board.consumers.redis.position.idInvalid");
  return null;
}

/**
 * XGROUP SETID.
 *
 * The dialog is explicit about what a reposition does not do, because both
 * surprises are expensive. It does not clear the pending list - entries already
 * handed out stay owed to the consumers holding them - and it redelivers
 * nothing on its own.
 */
export function PositionDialog({
  stream,
  group,
  open,
  onOpenChange,
  onMove,
}: {
  stream: string | null;
  group: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (position: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PositionForm>(emptyPositionForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyPositionForm());
      setError(null);
    }
  }, [open]);

  const invalid = validate(form, t);

  const submit = async () => {
    if (invalid != null || busy || group == null) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(toPosition(form));
      onOpenChange(false);
    } catch (moveError) {
      setError(formatErrorMessage(moveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {t("board.consumers.redis.position.title", { name: group ?? "", stream: stream ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.consumers.redis.position.moveTo")}</FieldLabel>
            <Segmented
              style={{ alignSelf: "flex-start" }}
              value={form.choice}
              onChange={(next: PositionChoice) => setForm((current) => ({ ...current, choice: next }))}
              options={[
                { value: "beginning", label: t("board.consumers.redis.position.beginning") },
                { value: "end", label: t("board.consumers.redis.position.end") },
                { value: "entry", label: t("board.consumers.redis.position.entry") },
              ]}
            />
            <FieldDescription>
              {t(`board.consumers.redis.position.${form.choice}Hint`)}
            </FieldDescription>
          </Field>

          {form.choice === "entry" && (
            <Field>
              <FieldLabel htmlFor="redis-position-id">Entry ID</FieldLabel>
              <Input
                id="redis-position-id"
                className="mono3"
                value={form.entryId}
                placeholder="1756454646018-0"
                onChange={(event) =>
                  setForm((current) => ({ ...current, entryId: event.target.value }))
                }
              />
            </Field>
          )}

          {/* The two things this does not do. Both are worth the space: an
              operator who expected either would go looking for messages that
              were never going to arrive. */}
          <FieldDescription>{t("board.consumers.redis.position.caveat")}</FieldDescription>

          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button
            disabled={invalid != null || busy}
            title={invalid ?? undefined}
            onClick={() => void submit()}
          >
            {busy && <Spinner className="size-3.5" />}
            {t("board.consumers.redis.position.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
