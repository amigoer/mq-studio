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
import { CodeEditor, Combobox, SelectField } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { Policy, PolicyInput } from "@/api/rabbitmq";

/**
 * What a policy can target.
 *
 * The type-specific ones matter: a definition meant for quorum queues applied
 * to "queues" would be rejected on every classic queue it matched, and the
 * broker reports that per queue rather than when the policy is saved.
 */
const APPLY_TO = [
  "queues",
  "classic_queues",
  "quorum_queues",
  "streams",
  "exchanges",
  "all",
] as const;

export interface PolicyForm {
  vhost: string;
  name: string;
  pattern: string;
  applyTo: string;
  priority: string;
  definition: string;
  operator: boolean;
}

export function emptyPolicyForm(): PolicyForm {
  return {
    vhost: "",
    name: "",
    pattern: "",
    applyTo: "queues",
    priority: "0",
    definition: "{}",
    operator: false,
  };
}

export function policyFormOf(policy: Policy): PolicyForm {
  return {
    vhost: policy.namespace,
    name: policy.name,
    pattern: policy.pattern,
    applyTo: policy.applyTo,
    priority: String(policy.priority),
    definition: prettyDefinition(policy.definition),
    operator: policy.operator,
  };
}

/** The definition reads better with newlines than as the one line it arrives as. */
export function prettyDefinition(definition: string): string {
  try {
    return JSON.stringify(JSON.parse(definition || "{}"), null, 2);
  } catch {
    return definition;
  }
}

export function toPolicyInput(form: PolicyForm): PolicyInput {
  const priority = Number.parseInt(form.priority.trim(), 10);
  return {
    vhost: form.vhost.trim(),
    name: form.name.trim(),
    pattern: form.pattern.trim(),
    applyTo: form.applyTo,
    priority: Number.isNaN(priority) ? 0 : priority,
    // Sent compact; the broker does not care and the pretty form is only for
    // the person editing it.
    definition: compactDefinition(form.definition),
    operator: form.operator,
  };
}

function compactDefinition(definition: string): string {
  try {
    return JSON.stringify(JSON.parse(definition || "{}"));
  } catch {
    return definition;
  }
}

export function validatePolicy(form: PolicyForm, t: (key: string) => string): string | null {
  if (form.vhost.trim() === "") return t("board.policies.rabbitmq.vhostRequired");
  if (form.name.trim() === "") return t("board.policies.rabbitmq.nameRequired");
  if (form.pattern.trim() === "") return t("board.policies.rabbitmq.patternRequired");

  let parsed: unknown;
  try {
    parsed = JSON.parse(form.definition || "{}");
  } catch {
    return t("board.policies.rabbitmq.definitionInvalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return t("board.policies.rabbitmq.definitionNotObject");
  }
  /* An empty definition is a policy that matches destinations and changes
     nothing about them - accepted by the broker, and never what anyone meant. */
  if (Object.keys(parsed as Record<string, unknown>).length === 0) {
    return t("board.policies.rabbitmq.definitionEmpty");
  }
  return null;
}

/**
 * Creating or editing a policy.
 *
 * Saving over an existing name replaces it, which is how the broker spells an
 * edit - so this dialog does both and the name plus virtual host is what
 * decides which.
 */
export function PolicyDialog({
  open,
  editing,
  vhosts,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing?: Policy;
  vhosts: readonly string[];
  onClose: () => void;
  onSubmit: (input: PolicyInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<PolicyForm>(emptyPolicyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing != null ? policyFormOf(editing) : emptyPolicyForm());
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const invalid = useMemo(() => validatePolicy(form, t), [form, t]);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toPolicyInput(form));
      onClose();
    } catch (saveError) {
      setError(formatErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3.5 overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {t(editing != null ? "board.policies.rabbitmq.edit" : "board.policies.rabbitmq.new")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.vhosts.rabbitmq.title")}</FieldLabel>
            <Combobox
              value={form.vhost}
              onValueChange={(next) => set("vhost", next)}
              options={vhosts}
              placeholder={t("board.acl.rabbitmq.pickVhost")}
              disabled={editing != null}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="policy-name">{t("board.policies.rabbitmq.name")}</FieldLabel>
            <Input
              id="policy-name"
              value={form.name}
              placeholder="order-queues-ttl"
              disabled={editing != null}
              onChange={(event) => set("name", event.target.value)}
            />
            {editing != null && (
              <FieldDescription>{t("board.policies.rabbitmq.nameFixed")}</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="policy-pattern">
              {t("board.policies.rabbitmq.pattern")}
            </FieldLabel>
            <Input
              id="policy-pattern"
              className="mono3"
              value={form.pattern}
              placeholder="^order\\."
              onChange={(event) => set("pattern", event.target.value)}
            />
            <FieldDescription>{t("board.policies.rabbitmq.patternHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("board.policies.rabbitmq.applyTo")}</FieldLabel>
            <SelectField
              value={form.applyTo}
              onValueChange={(next) => set("applyTo", next)}
              options={APPLY_TO.map((value) => ({ value }))}
            />
            <FieldDescription>{t("board.policies.rabbitmq.applyToHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="policy-priority">
              {t("board.policies.rabbitmq.priority")}
            </FieldLabel>
            <Input
              id="policy-priority"
              type="number"
              value={form.priority}
              onChange={(event) => set("priority", event.target.value)}
            />
            <FieldDescription>{t("board.policies.rabbitmq.priorityHint")}</FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="policy-operator">
              {t("board.policies.rabbitmq.operatorPolicy")}
            </FieldLabel>
            <Switch
              id="policy-operator"
              checked={form.operator}
              disabled={editing != null}
              onCheckedChange={(next: boolean) => set("operator", next)}
            />
          </Field>
          <FieldDescription>{t("board.policies.rabbitmq.operatorHint")}</FieldDescription>

          <Field>
            <FieldLabel>{t("board.policies.rabbitmq.definition")}</FieldLabel>
            <CodeEditor
              value={form.definition}
              onValueChange={(next: string) => set("definition", next)}
              language="json"
            />
            <FieldDescription>{t("board.policies.rabbitmq.definitionHint")}</FieldDescription>
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
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
