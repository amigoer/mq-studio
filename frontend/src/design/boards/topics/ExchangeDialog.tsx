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
import { Switch } from "@/components/ui/switch";
import { Combobox, Segmented, SelectField } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { BindingInput, ExchangeDeclaration } from "@/api/rabbitmq";

/**
 * The four exchange types, which are four different routing rules and not a
 * setting that can be changed afterwards.
 */
const TYPES = [
  { value: "topic", label: "topic" },
  { value: "direct", label: "direct" },
  { value: "fanout", label: "fanout" },
  { value: "headers", label: "headers" },
] as const;

export interface ExchangeForm {
  name: string;
  vhost: string;
  type: string;
  transient: boolean;
  autoDelete: boolean;
  alternateExchange: string;
}

export function emptyExchangeForm(vhost: string): ExchangeForm {
  return {
    name: "",
    vhost,
    type: "topic",
    transient: false,
    autoDelete: false,
    alternateExchange: "",
  };
}

export function toExchangeDeclaration(form: ExchangeForm): ExchangeDeclaration {
  const args: Record<string, unknown> = {};
  if (form.alternateExchange.trim() !== "") {
    args["alternate-exchange"] = form.alternateExchange.trim();
  }
  return {
    vhost: form.vhost,
    name: form.name.trim(),
    type: form.type,
    transient: form.transient,
    autoDelete: form.autoDelete,
    arguments: JSON.stringify(args),
  };
}

export function validateExchange(
  form: ExchangeForm,
  t: (key: string) => string,
): string | null {
  if (form.name.trim() === "") return t("board.topics.rabbitmq.exchangeNameRequired");
  if (form.name.trim().startsWith("amq.")) return t("board.topics.rabbitmq.nameReserved");
  // An alternate exchange pointing at itself makes an unroutable message loop
  // back into the same exchange, which the broker accepts and which does
  // nothing useful.
  if (form.alternateExchange.trim() === form.name.trim() && form.name.trim() !== "") {
    return t("board.topics.rabbitmq.alternateIsSelf");
  }
  return null;
}

/** Declaring an exchange. There is no edit twin: the type is fixed once set. */
export function ExchangeDialog({
  open,
  vhost,
  exchanges,
  onClose,
  onSubmit,
}: {
  open: boolean;
  vhost: string;
  exchanges: readonly string[];
  onClose: () => void;
  onSubmit: (declaration: ExchangeDeclaration) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ExchangeForm>(() => emptyExchangeForm(vhost));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyExchangeForm(vhost));
    setError(null);
    setSaving(false);
  }, [open, vhost]);

  const set = <K extends keyof ExchangeForm>(key: K, value: ExchangeForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validateExchange(form, t), [form, t]);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toExchangeDeclaration(form));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.rabbitmq.newExchange")}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="exchange-name">{t("board.common.exchange")}</FieldLabel>
            <Input
              id="exchange-name"
              value={form.name}
              placeholder="ex.order"
              onChange={(event) => set("name", event.target.value)}
            />
            <FieldDescription>
              {t("board.topics.rabbitmq.exchangeNameHint", { vhost })}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.common.type")}</FieldLabel>
            <Segmented
              block
              value={form.type}
              onChange={(next: string) => set("type", next)}
              options={TYPES.map((type) => ({ ...type }))}
            />
            <FieldDescription>
              {t(`board.topics.rabbitmq.exchangeTypeHint.${form.type}`)}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.topics.rabbitmq.alternateExchange")}</FieldLabel>
            <Combobox
              value={form.alternateExchange}
              onValueChange={(next) => set("alternateExchange", next)}
              options={exchanges}
              placeholder={t("board.topics.rabbitmq.alternateNone")}
            />
            <FieldDescription>
              {t("board.topics.rabbitmq.alternateHint")}
            </FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="exchange-transient">
              {t("board.topics.rabbitmq.transient")}
            </FieldLabel>
            <Switch
              id="exchange-transient"
              checked={form.transient}
              onCheckedChange={(next: boolean) => set("transient", next)}
            />
          </Field>
          <FieldDescription>{t("board.topics.rabbitmq.transientHint")}</FieldDescription>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="exchange-autodelete">
              {t("board.topics.rabbitmq.autoDeleteExchange")}
            </FieldLabel>
            <Switch
              id="exchange-autodelete"
              checked={form.autoDelete}
              onCheckedChange={(next: boolean) => set("autoDelete", next)}
            />
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
          <Button disabled={invalid != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.topics.rabbitmq.declare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface BindingForm {
  destinationKind: string;
  destination: string;
  routingKey: string;
  headerMatch: string;
  headers: string;
}

export function emptyBindingForm(): BindingForm {
  return {
    destinationKind: "queue",
    destination: "",
    routingKey: "",
    headerMatch: "all",
    headers: "",
  };
}

/**
 * Turns the binding form into what the broker receives.
 *
 * A headers exchange ignores the routing key entirely and matches on
 * arguments, so the form sends one or the other rather than both - sending a
 * routing key to a headers exchange is a value that silently does nothing.
 */
export function toBindingInput(
  form: BindingForm,
  vhost: string,
  source: string,
  sourceType: string,
): BindingInput {
  const args: Record<string, string> = {};
  if (sourceType === "headers") {
    args["x-match"] = form.headerMatch;
    for (const line of form.headers.split("\n")) {
      const [name, ...rest] = line.split("=");
      if (name != null && name.trim() !== "" && rest.length > 0) {
        args[name.trim()] = rest.join("=").trim();
      }
    }
  }
  return {
    vhost,
    source,
    destination: form.destination.trim(),
    destinationKind: form.destinationKind,
    routingKey: sourceType === "headers" ? "" : form.routingKey.trim(),
    arguments: args,
    // Only a delete needs one, and it always comes from the listing.
    propertiesKey: "",
  };
}

export function validateBinding(
  form: BindingForm,
  sourceType: string,
  t: (key: string) => string,
): string | null {
  if (form.destination.trim() === "") return t("board.topics.rabbitmq.bindTargetRequired");
  // A direct exchange with no routing key binds to the empty key, which
  // matches only messages published with no key - almost never what was meant.
  if (sourceType === "direct" && form.routingKey.trim() === "") {
    return t("board.topics.rabbitmq.bindDirectNeedsKey");
  }
  if (sourceType === "headers" && form.headers.trim() === "") {
    return t("board.topics.rabbitmq.bindHeadersNeedsHeaders");
  }
  return null;
}

/** Adding a binding out of one exchange. */
export function BindingDialog({
  open,
  source,
  sourceType,
  vhost,
  queues,
  exchanges,
  onClose,
  onSubmit,
}: {
  open: boolean;
  source: string;
  sourceType: string;
  vhost: string;
  queues: readonly string[];
  exchanges: readonly string[];
  onClose: () => void;
  onSubmit: (binding: BindingInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<BindingForm>(emptyBindingForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(emptyBindingForm());
    setError(null);
    setSaving(false);
  }, [open]);

  const set = <K extends keyof BindingForm>(key: K, value: BindingForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validateBinding(form, sourceType, t), [form, sourceType, t]);
  const targets = form.destinationKind === "queue" ? queues : exchanges.filter((n) => n !== source);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toBindingInput(form, vhost, source, sourceType));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.rabbitmq.addBindingTitle", { source })}</DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.common.target")}</FieldLabel>
            <Segmented
              block
              value={form.destinationKind}
              onChange={(next: string) => setForm((c) => ({ ...c, destinationKind: next, destination: "" }))}
              options={[
                { value: "queue", label: t("board.common.queue") },
                { value: "exchange", label: t("board.common.exchange") },
              ]}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.topics.rabbitmq.bindTo")}</FieldLabel>
            <Combobox
              value={form.destination}
              onValueChange={(next) => set("destination", next)}
              options={targets}
              placeholder={t("board.topics.rabbitmq.bindPickTarget")}
            />
          </Field>

          {/* A headers exchange ignores the routing key entirely, so offering
              one would be offering a field that does nothing. */}
          {sourceType === "headers" ? (
            <>
              <Field>
                <FieldLabel>{t("board.topics.rabbitmq.headerMatch")}</FieldLabel>
                <SelectField
                  value={form.headerMatch}
                  onValueChange={(next) => set("headerMatch", next)}
                  options={[
                    { value: "all", label: t("board.topics.rabbitmq.matchAll") },
                    { value: "any", label: t("board.topics.rabbitmq.matchAny") },
                  ]}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="bind-headers">
                  {t("board.topics.rabbitmq.bindHeaders")}
                </FieldLabel>
                <Input
                  id="bind-headers"
                  className="mono3"
                  value={form.headers}
                  placeholder="kind=order"
                  onChange={(event) => set("headers", event.target.value)}
                />
                <FieldDescription>
                  {t("board.topics.rabbitmq.bindHeadersHint")}
                </FieldDescription>
              </Field>
            </>
          ) : (
            <Field>
              <FieldLabel htmlFor="bind-rk">
                {t("board.messages.rabbitmq.routingKey")}
              </FieldLabel>
              <Input
                id="bind-rk"
                className="mono3"
                value={form.routingKey}
                placeholder={sourceType === "topic" ? "order.*" : "order.created"}
                onChange={(event) => set("routingKey", event.target.value)}
                // A fanout ignores the key, so the field stays visible for
                // consistency and says why it does nothing.
                disabled={sourceType === "fanout"}
              />
              <FieldDescription>
                {t(`board.topics.rabbitmq.bindKeyHint.${sourceType}`)}
              </FieldDescription>
            </Field>
          )}
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
          <Button disabled={invalid != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.topics.rabbitmq.addBinding")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
