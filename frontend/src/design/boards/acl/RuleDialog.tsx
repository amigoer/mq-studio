import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
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
import { Panel, Segmented, SelectField } from "@/components";
import type { AccessRule } from "@/api/acl";
import { formatErrorMessage } from "@/lib/utils";

/** RocketMQ 5.3's own vocabulary, kept verbatim so it round-trips. */
const EFFECTS = ["Allow", "Deny"] as const;
const ACTIONS = ["Pub", "Sub", "Get", "Create", "Update", "Delete", "List", "All"] as const;

export interface PolicyForm {
  resource: string;
  actions: string[];
  effect: string;
  sourceIps: string[];
}

export interface RuleForm {
  subject: string;
  description: string;
  policies: PolicyForm[];
}

function emptyPolicy(): PolicyForm {
  return { resource: "", actions: ["Pub", "Sub"], effect: EFFECTS[0], sourceIps: [] };
}

function splitAddresses(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((one) => one.trim())
    .filter((one) => one !== "");
}

/**
 * Everything one subject may do, edited as a whole.
 *
 * The form submits the complete policy set rather than the row that changed,
 * because that is what the broker takes: handing it one policy for a subject
 * that had three leaves the subject with one. Saying so on the dialog is
 * cheaper than letting somebody find out.
 */
export function RuleDialog({
  open,
  editing,
  subjects,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The rule being edited, or undefined to attach policies to a new subject. */
  editing: AccessRule | undefined;
  /** Principals the broker knows, so a subject is picked rather than typed. */
  subjects: readonly string[];
  onClose: () => void;
  onSubmit: (form: RuleForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RuleForm>({
    subject: "",
    description: "",
    policies: [emptyPolicy()],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      subject: editing?.subject ?? "",
      description: editing?.description ?? "",
      policies:
        editing == null || editing.policies.length === 0
          ? [emptyPolicy()]
          : editing.policies.map((policy) => ({
              resource: policy.resource,
              actions: [...policy.actions],
              effect: policy.effect || EFFECTS[0],
              sourceIps: [...policy.sourceIps],
            })),
    });
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const patch = (index: number, next: Partial<PolicyForm>) =>
    setForm((current) => ({
      ...current,
      policies: current.policies.map((policy, at) =>
        at === index ? { ...policy, ...next } : policy,
      ),
    }));

  const invalid =
    form.subject.trim() === ""
      ? t("board.acl.rule.subjectRequired")
      : form.policies.some((policy) => policy.resource.trim() === "")
        ? t("board.acl.rule.resourceRequired")
        : form.policies.some((policy) => policy.actions.length === 0)
          ? t("board.acl.rule.actionRequired")
          : null;

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...form,
        subject: form.subject.trim(),
        policies: form.policies.map((policy) => ({
          ...policy,
          resource: policy.resource.trim(),
        })),
      });
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>
            {t(editing == null ? "board.acl.rule.create" : "board.acl.rule.edit")}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel>{t("board.acl.rule.subject")}</FieldLabel>
            {editing != null || subjects.length === 0 ? (
              <Input
                className="mono3"
                value={form.subject}
                disabled={editing != null}
                placeholder={t("board.acl.rule.subjectPlaceholder")}
                onChange={(event) =>
                  setForm((current) => ({ ...current, subject: event.target.value }))
                }
              />
            ) : (
              <SelectField
                size="default"
                className="w-full"
                value={form.subject}
                onValueChange={(next) => setForm((current) => ({ ...current, subject: next }))}
                placeholder={t("board.acl.rule.subjectPlaceholder")}
                options={subjects.map((name) => ({ value: name }))}
              />
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="rule-description">{t("board.acl.rule.description")}</FieldLabel>
            <Input
              id="rule-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </Field>
        </FieldGroup>

        <div className="flex max-h-[40vh] flex-col gap-2 overflow-auto">
          {form.policies.map((policy, index) => (
            <Panel key={index} className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <Input
                  className="mono3 min-w-0 flex-1"
                  value={policy.resource}
                  placeholder={t("board.acl.rule.resourcePlaceholder")}
                  onChange={(event) => patch(index, { resource: event.target.value })}
                />
                <Segmented
                  value={policy.effect}
                  onChange={(next: string) => patch(index, { effect: next })}
                  options={EFFECTS.map((value) => ({ value, label: value }))}
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("board.acl.rule.removePolicy")}
                  disabled={form.policies.length === 1}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      policies: current.policies.filter((_, at) => at !== index),
                    }))
                  }
                >
                  <X />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.map((action) => {
                  const on = policy.actions.includes(action);
                  return (
                    <button
                      key={action}
                      type="button"
                      aria-pressed={on}
                      className={
                        "rounded-md border px-2 py-0.5 text-xs transition-colors " +
                        (on
                          ? "border-transparent bg-(--c-fg) text-(--c-bg)"
                          : "text-(--c-muted) hover:bg-(--c-fill)")
                      }
                      onClick={() =>
                        patch(index, {
                          actions: on
                            ? policy.actions.filter((one) => one !== action)
                            : [...policy.actions, action],
                        })
                      }
                    >
                      {action}
                    </button>
                  );
                })}
              </div>

              <Input
                className="mono3"
                value={policy.sourceIps.join(", ")}
                placeholder={t("board.acl.rule.sourcePlaceholder")}
                onChange={(event) =>
                  patch(index, { sourceIps: splitAddresses(event.target.value) })
                }
              />
            </Panel>
          ))}

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setForm((current) => ({ ...current, policies: [...current.policies, emptyPolicy()] }))
            }
          >
            <Plus size={13} aria-hidden />
            {t("board.acl.rule.addPolicy")}
          </Button>
        </div>

        <FieldDescription className="text-xs">{t("board.acl.rule.replaceNote")}</FieldDescription>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "mr-auto max-w-72 text-xs " +
                (error != null ? "text-(--c-err)" : "text-muted-foreground")
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
