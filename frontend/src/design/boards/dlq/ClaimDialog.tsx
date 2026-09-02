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
import { formatErrorMessage } from "@/lib/utils";

export interface ClaimForm {
  consumer: string;
  /** Minutes, as text: an empty box is not a zero, and zero is a real answer. */
  minIdleMinutes: string;
}

export function emptyClaimForm(): ClaimForm {
  return { consumer: "", minIdleMinutes: "1" };
}

/**
 * The guard, in milliseconds, or null when the form is not usable.
 *
 * Zero is deliberate rather than absent: it moves the entries whatever their
 * idle time, which is right when a consumer is known to be gone and wrong
 * whenever it is merely busy. A form that could not express it would push
 * people to guess a number instead.
 */
export function minIdleMsOf(form: ClaimForm): number | null {
  const minutes = form.minIdleMinutes.trim();
  if (!/^\d+$/.test(minutes)) return null;
  return Number(minutes) * 60_000;
}

export function validate(form: ClaimForm, t: (key: string) => string): string | null {
  if (form.consumer.trim() === "") return t("board.dlq.redis.claim.consumerRequired");
  if (minIdleMsOf(form) == null) return t("board.dlq.redis.claim.idleInvalid");
  return null;
}

/**
 * Moving pending entries to another consumer.
 *
 * The minimum idle time is the whole safety of this gesture. Without it a claim
 * takes work from a consumer that is simply busy, and both then believe they
 * own the same entry - so the field is required, defaults to a minute, and says
 * what zero means rather than hiding it.
 */
export function ClaimDialog({
  open,
  count,
  auto,
  onOpenChange,
  onClaim,
}: {
  open: boolean;
  /** How many entries were selected, or 0 for an auto-claim over the list. */
  count: number;
  /** True when this moves whatever is idle rather than a named selection. */
  auto: boolean;
  onOpenChange: (open: boolean) => void;
  onClaim: (consumer: string, minIdleMs: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ClaimForm>(emptyClaimForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyClaimForm());
      setError(null);
    }
  }, [open]);

  const invalid = validate(form, t);
  const minIdleMs = minIdleMsOf(form);

  const submit = async () => {
    if (invalid != null || busy || minIdleMs == null) return;
    setBusy(true);
    setError(null);
    try {
      await onClaim(form.consumer.trim(), minIdleMs);
      onOpenChange(false);
    } catch (claimError) {
      setError(formatErrorMessage(claimError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {auto
              ? t("board.dlq.redis.claim.autoTitle")
              : t("board.dlq.redis.claim.title", { count })}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="redis-claim-consumer">
              {t("board.dlq.redis.claim.consumer")}
            </FieldLabel>
            <Input
              id="redis-claim-consumer"
              className="mono3"
              value={form.consumer}
              placeholder="worker-1"
              onChange={(event) =>
                setForm((current) => ({ ...current, consumer: event.target.value }))
              }
            />
            <FieldDescription>{t("board.dlq.redis.claim.consumerHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="redis-claim-idle">
              {t("board.dlq.redis.claim.minIdle")}
            </FieldLabel>
            <Input
              id="redis-claim-idle"
              className="mono3"
              inputMode="numeric"
              value={form.minIdleMinutes}
              onChange={(event) =>
                setForm((current) => ({ ...current, minIdleMinutes: event.target.value }))
              }
            />
            <FieldDescription>
              {form.minIdleMinutes.trim() === "0"
                ? t("board.dlq.redis.claim.minIdleZero")
                : t("board.dlq.redis.claim.minIdleHint")}
            </FieldDescription>
          </Field>

          {auto && <FieldDescription>{t("board.dlq.redis.claim.autoHint")}</FieldDescription>}

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
            {t("board.dlq.redis.claim.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
