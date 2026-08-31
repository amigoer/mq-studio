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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SelectField, useToast } from "@/components";
import { putKafkaAccessRule } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyAclRuleDraft,
  toAccessRule,
  validateAclRuleDraft,
  type AclRuleDraft,
} from "./aclKafkaDraft";

export function AclRuleDialogKafka({
  open,
  operations,
  resourceKinds,
  onClose,
  onSaved,
}: {
  open: boolean;
  operations: string[];
  resourceKinds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<AclRuleDraft>(emptyAclRuleDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyAclRuleDraft());
  }, [open]);

  const policy = draft.policies[0]!;
  const setPolicy = (patch: Partial<typeof policy>) =>
    setDraft((current) => ({ ...current, policies: [{ ...current.policies[0]!, ...patch }] }));

  const problem = validateAclRuleDraft(draft);

  const save = async () => {
    if (problem != null) return;
    setSaving(true);
    try {
      await putKafkaAccessRule(connID, toAccessRule(draft));
      toast.success(t("board.acl.kafka.ruleSaved", { subject: draft.subject.trim() }));
      onSaved();
      onClose();
    } catch (failure) {
      toast.error(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex flex-col gap-3.5 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.acl.kafka.newRule")}</DialogTitle>
        </DialogHeader>

        <Field label={t("board.acl.kafka.principal")} hint={t("board.acl.kafka.principalHint")}>
          <Input
            className="mono3"
            value={draft.subject}
            placeholder="User:alice"
            onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))}
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px 14px" }}>
          <Field label={t("board.acl.kafka.resourceKind")}>
            <SelectField
              value={policy.kind}
              options={resourceKinds.map((kind) => ({ value: kind }))}
              onValueChange={(next) => setPolicy({ kind: next })}
            />
          </Field>
          <Field label={t("board.acl.kafka.resourceName")}>
            <Input
              className="mono3"
              disabled={policy.kind === "cluster"}
              value={policy.name}
              placeholder={policy.kind === "cluster" ? t("board.acl.kafka.clusterItself") : "orders"}
              onChange={(event) => setPolicy({ name: event.target.value })}
            />
          </Field>
        </div>

        {policy.kind !== "cluster" && (
          <Field label={t("board.acl.kafka.prefixed")} hint={t("board.acl.kafka.prefixedHint")}>
            <Switch
              checked={policy.prefixed}
              onCheckedChange={(next) => setPolicy({ prefixed: next })}
            />
          </Field>
        )}

        <Field label={t("board.acl.kafka.operation")}>
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="flex-wrap justify-start"
            value={policy.operations}
            onValueChange={(next: string[]) => setPolicy({ operations: next })}
          >
            {operations.map((operation) => (
              <ToggleGroupItem key={operation} value={operation} className="text-[11px]">
                {operation}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          <Field label={t("board.acl.kafka.effect")}>
            <SelectField<"Allow" | "Deny">
              value={policy.effect}
              options={[
                { value: "Allow", label: "Allow" },
                { value: "Deny", label: "Deny" },
              ]}
              onValueChange={(next) => setPolicy({ effect: next })}
            />
          </Field>
          <Field label={t("board.acl.kafka.from")} hint={t("board.acl.kafka.fromHint")}>
            <Input
              className="mono3"
              value={policy.host}
              placeholder={t("board.acl.kafka.anywhere")}
              onChange={(event) => setPolicy({ host: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter className="items-center">
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {t("board.acl.kafka.denyNote")}
          </span>
          <span className="flex-1" />
          {problem != null && (
            <span className="max-w-64 text-right text-xs text-muted-foreground">
              {t(`board.acl.kafka.invalid.${problem}`)}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={problem != null || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs">
      <span className="font-medium">
        {label} {hint != null && <span className="font-normal text-(--c-muted-2)">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
