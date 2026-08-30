import { useEffect, useMemo, useState } from "react";
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
import { Combobox, Segmented, WarnBanner } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { MoveRequest } from "@/api/rabbitmq";

/** Where a batch is going: straight into a queue, or through an exchange. */
type Target = "queue" | "exchange";

export interface MoveForm {
  target: Target;
  queue: string;
  exchange: string;
  routingKey: string;
  limit: string;
}

export function emptyMoveForm(): MoveForm {
  return { target: "queue", queue: "", exchange: "", routingKey: "", limit: "100" };
}

/**
 * Turns the form into the request.
 *
 * Sending to a queue is publishing to the default exchange with the queue's
 * name as the routing key - that is not a shortcut, it is how RabbitMQ works,
 * and spelling it out here keeps the driver from having to guess what an empty
 * exchange meant.
 */
export function toMoveRequest(form: MoveForm, vhost: string, from: string): MoveRequest {
  const limit = Number.parseInt(form.limit.trim(), 10);
  return {
    vhost,
    from,
    toExchange: form.target === "queue" ? "" : form.exchange.trim(),
    toRoutingKey: form.target === "queue" ? form.queue.trim() : form.routingKey.trim(),
    limit: Number.isNaN(limit) || limit <= 0 ? 100 : limit,
  };
}

export function validateMove(
  form: MoveForm,
  from: string,
  t: (key: string) => string,
): string | null {
  if (form.target === "queue") {
    if (form.queue.trim() === "") return t("board.topics.rabbitmq.moveTargetRequired");
    // Draining a queue into itself moves every message to the back of it and
    // nothing else, which is never what anyone meant.
    if (form.queue.trim() === from) return t("board.topics.rabbitmq.moveToSelf");
    return null;
  }
  if (form.exchange.trim() === "") return t("board.topics.rabbitmq.moveExchangeRequired");
  return null;
}

/**
 * Moving a batch out of a queue.
 *
 * The main use is putting dead letters back, so the defaults suit that: a
 * bounded batch rather than the whole backlog, because each message costs a
 * round trip and a confirm.
 */
export function MoveDialog({
  open,
  vhost,
  from,
  queues,
  exchanges,
  onClose,
  onSubmit,
}: {
  open: boolean;
  vhost: string;
  from: string;
  queues: readonly string[];
  exchanges: readonly string[];
  onClose: () => void;
  onSubmit: (request: MoveRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<MoveForm>(emptyMoveForm);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyMoveForm());
    setError(null);
    setRunning(false);
  }, [open]);

  const set = <K extends keyof MoveForm>(key: K, value: MoveForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validateMove(form, from, t), [form, from, t]);

  const run = async () => {
    if (invalid != null) return;
    setRunning(true);
    setError(null);
    try {
      await onSubmit(toMoveRequest(form, vhost, from));
      onClose();
    } catch (moveError) {
      setError(formatErrorMessage(moveError));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.rabbitmq.moveTitle", { name: from })}</DialogTitle>
        </DialogHeader>

        {/* What a move actually guarantees, said once. */}
        <WarnBanner>{t("board.topics.rabbitmq.moveWarn")}</WarnBanner>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.topics.rabbitmq.moveTarget")}</FieldLabel>
            <Segmented
              block
              value={form.target}
              onChange={(next: Target) => set("target", next)}
              options={[
                { value: "queue", label: t("board.common.queue") },
                { value: "exchange", label: t("board.common.exchange") },
              ]}
            />
          </Field>

          {form.target === "queue" ? (
            <Field>
              <FieldLabel>{t("board.topics.rabbitmq.moveToQueue")}</FieldLabel>
              <Combobox
                value={form.queue}
                onValueChange={(next) => set("queue", next)}
                options={queues.filter((name) => name !== from)}
                placeholder={t("board.topics.rabbitmq.movePickQueue")}
              />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>{t("board.topics.rabbitmq.moveToExchange")}</FieldLabel>
                <Combobox
                  value={form.exchange}
                  onValueChange={(next) => set("exchange", next)}
                  options={exchanges}
                  placeholder={t("board.topics.rabbitmq.movePickExchange")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="move-rk">
                  {t("board.messages.rabbitmq.routingKey")}
                </FieldLabel>
                <Input
                  id="move-rk"
                  className="mono3"
                  value={form.routingKey}
                  onChange={(event) => set("routingKey", event.target.value)}
                />
                <FieldDescription>
                  {t("board.topics.rabbitmq.moveRoutingKeyHint")}
                </FieldDescription>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel htmlFor="move-limit">{t("board.topics.rabbitmq.moveLimit")}</FieldLabel>
            <Input
              id="move-limit"
              type="number"
              min={1}
              value={form.limit}
              onChange={(event) => set("limit", event.target.value)}
            />
            <FieldDescription>{t("board.topics.rabbitmq.moveLimitHint")}</FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "flex-1 text-xs " + (error != null ? "text-(--c-err)" : "text-muted-foreground")
              }
            >
              {error ?? invalid}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={invalid != null || running} onClick={() => void run()}>
            {running && <Spinner />}
            {t("board.topics.rabbitmq.moveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
