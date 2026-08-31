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
import { SelectField, WarnBanner, useToast } from "@/components";
import { putKafkaPrincipal } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyScramUserDraft,
  toPrincipalSpec,
  validateScramUserDraft,
  type ScramUserDraft,
} from "./aclKafkaDraft";

export function ScramUserDialogKafka({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<ScramUserDraft>(emptyScramUserDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyScramUserDraft());
  }, [open]);

  const set = <K extends keyof ScramUserDraft>(key: K, value: ScramUserDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const problem = validateScramUserDraft(draft);

  const save = async () => {
    if (problem != null) return;
    setSaving(true);
    try {
      await putKafkaPrincipal(connID, toPrincipalSpec(draft));
      toast.success(t("board.acl.kafka.userSaved", { name: draft.name.trim() }));
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
      <DialogContent className="flex flex-col gap-3.5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t("board.acl.kafka.newUser")}</DialogTitle>
        </DialogHeader>

        <Field label={t("board.acl.kafka.user")}>
          <Input
            className="mono3"
            value={draft.name}
            placeholder="alice"
            onChange={(event) => set("name", event.target.value)}
          />
        </Field>
        <Field label={t("board.acl.kafka.mechanism")} hint={t("board.acl.kafka.mechanismHint")}>
          <SelectField
            value={draft.mechanism}
            options={[
              { value: "SCRAM-SHA-512", label: "SCRAM-SHA-512" },
              { value: "SCRAM-SHA-256", label: "SCRAM-SHA-256" },
            ]}
            onValueChange={(next) => set("mechanism", next)}
          />
        </Field>
        <Field label={t("page.connections.form.password")}>
          <Input
            type="password"
            value={draft.password}
            onChange={(event) => set("password", event.target.value)}
          />
        </Field>

        {/* Said before the attempt: there is no "leave blank to keep the old
            one" here, because the cluster stores it salted and cannot be asked
            for it again. */}
        <WarnBanner>{t("board.acl.kafka.passwordNote")}</WarnBanner>

        <DialogFooter className="items-center">
          <span className="flex-1" />
          {problem != null && (
            <span className="max-w-56 text-right text-xs text-muted-foreground">
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
