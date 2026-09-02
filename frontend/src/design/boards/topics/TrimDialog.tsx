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
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { TrimRequest, TrimStrategy } from "@/api/redis";

export interface TrimForm {
  strategy: TrimStrategy;
  /** Kept as text: an empty field is not a zero, and zero empties the stream. */
  maxLen: string;
  minId: string;
  approx: boolean;
}

export function emptyTrimForm(): TrimForm {
  return {
    strategy: "maxlen",
    maxLen: "",
    minId: "",
    // On by default, which is what Redis's own documentation recommends: the
    // exact form has to split a macro node and is far more expensive on the
    // large streams anyone actually needs to trim.
    approx: true,
  };
}

/**
 * What the form asks for, or the reason it cannot be submitted.
 *
 * A trim is not reversible and the two strategies discard different things, so
 * the checks are on the values rather than on the button being enabled: a
 * length field that reads as NaN would otherwise become a trim to zero.
 */
export function validate(form: TrimForm, t: (key: string) => string): string | null {
  if (form.strategy === "maxlen") {
    if (form.maxLen.trim() === "") return t("board.topics.redis.trim.lengthRequired");
    // Digits, not Number(): "1e3" is an integer as far as Number.isInteger is
    // concerned, so a length typed that way would quietly become 1000 on an
    // operation with no undo. What the user typed and what runs have to match
    // character for character here.
    if (!/^\d+$/.test(form.maxLen.trim())) {
      return t("board.topics.redis.trim.lengthInvalid");
    }
    return null;
  }
  if (form.minId.trim() === "") return t("board.topics.redis.trim.idRequired");
  // A stream id is <milliseconds>-<sequence>, and Redis accepts the
  // milliseconds alone. Anything else is refused here rather than by the
  // server, because a rejected trim reads like a failure of the button.
  if (!/^\d+(-\d+)?$/.test(form.minId.trim())) {
    return t("board.topics.redis.trim.idInvalid");
  }
  return null;
}

export function toRequest(stream: string, form: TrimForm): TrimRequest {
  return {
    stream,
    strategy: form.strategy,
    maxLen: form.strategy === "maxlen" ? Number(form.maxLen.trim()) : 0,
    minId: form.strategy === "minid" ? form.minId.trim() : "",
    // Only meaningful on a length trim in practice, but Redis accepts it for
    // both and the server decides - so it travels as the form set it.
    approx: form.approx,
  };
}

/** True when the form would empty the stream rather than shorten it. */
export function empties(form: TrimForm): boolean {
  return form.strategy === "maxlen" && form.maxLen.trim() === "0";
}

/**
 * XTRIM, both ways of naming a bound.
 *
 * The dialog is deliberately explicit about which entries go, because the two
 * strategies answer different questions and neither is undoable: a length
 * keeps a count and lets the oldest go whatever they are; a minimum id keeps a
 * moment and lets everything before it go however many that is.
 */
export function TrimDialog({
  stream,
  open,
  onOpenChange,
  onTrim,
}: {
  stream: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTrim: (request: TrimRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<TrimForm>(emptyTrimForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyTrimForm());
      setError(null);
    }
  }, [open]);

  const set = <K extends keyof TrimForm>(key: K, next: TrimForm[K]) =>
    setForm((current) => ({ ...current, [key]: next }));

  const invalid = validate(form, t);

  const submit = async () => {
    if (invalid != null || busy || stream == null) return;
    setBusy(true);
    setError(null);
    try {
      await onTrim(toRequest(stream, form));
      onOpenChange(false);
    } catch (trimError) {
      setError(formatErrorMessage(trimError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.redis.trim.title", { name: stream ?? "" })}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.topics.redis.trim.strategy")}</FieldLabel>
            <Segmented
              style={{ alignSelf: "flex-start" }}
              value={form.strategy}
              onChange={(next: TrimStrategy) => set("strategy", next)}
              options={[
                { value: "maxlen", label: "MAXLEN" },
                { value: "minid", label: "MINID" },
              ]}
            />
            <FieldDescription>
              {form.strategy === "maxlen"
                ? t("board.topics.redis.trim.maxlenHint")
                : t("board.topics.redis.trim.minidHint")}
            </FieldDescription>
          </Field>

          {form.strategy === "maxlen" ? (
            <Field>
              <FieldLabel htmlFor="redis-trim-maxlen">
                {t("board.topics.redis.trim.length")}
              </FieldLabel>
              <Input
                id="redis-trim-maxlen"
                className="mono3"
                inputMode="numeric"
                value={form.maxLen}
                placeholder="10000"
                onChange={(event) => set("maxLen", event.target.value)}
              />
              {empties(form) && (
                <FieldDescription style={{ color: "var(--c-warn-text)" }}>
                  {t("board.topics.redis.trim.emptiesWarning")}
                </FieldDescription>
              )}
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="redis-trim-minid">
                {t("board.topics.redis.trim.minId")}
              </FieldLabel>
              <Input
                id="redis-trim-minid"
                className="mono3"
                value={form.minId}
                placeholder="1756454646018-0"
                onChange={(event) => set("minId", event.target.value)}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>{t("board.topics.redis.trim.approx")}</FieldLabel>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Switch checked={form.approx} onCheckedChange={(next) => set("approx", next)} />
              <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                {t("board.topics.redis.trim.approxNote")}
              </span>
            </div>
          </Field>

          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button
            variant={empties(form) ? "destructive" : "default"}
            disabled={invalid != null || busy}
            title={invalid ?? undefined}
            onClick={() => void submit()}
          >
            {busy && <Spinner className="size-3.5" />}
            {t("board.topics.redis.trim.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
