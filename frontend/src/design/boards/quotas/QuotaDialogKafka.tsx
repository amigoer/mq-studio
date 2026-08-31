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
import { SelectField, WarnBanner, useToast } from "@/components";
import { alterKafkaQuota } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyQuotaDraft,
  toQuotaEntity,
  toQuotaLimits,
  validateQuotaDraft,
  type QuotaDraft,
} from "./quotaDraft";

export function QuotaDialogKafka({
  open,
  entityTypes,
  limits,
  onClose,
  onSaved,
}: {
  open: boolean;
  entityTypes: string[];
  limits: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<QuotaDraft>(() => emptyQuotaDraft(limits));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyQuotaDraft(limits));
  }, [open, limits]);

  const entity = draft.entity[0]!;
  const setEntity = (patch: Partial<typeof entity>) =>
    setDraft((current) => ({ ...current, entity: [{ ...current.entity[0]!, ...patch }] }));
  const setLimit = (key: string, value: string) =>
    setDraft((current) => ({ ...current, limits: { ...current.limits, [key]: value } }));

  const problem = validateQuotaDraft(draft);

  const save = async () => {
    if (problem != null) return;
    setSaving(true);
    try {
      await alterKafkaQuota(connID, toQuotaEntity(draft), toQuotaLimits(draft), []);
      toast.success(t("board.quotas.kafka.saved"));
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
      <DialogContent className="flex flex-col gap-3.5 sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("board.quotas.kafka.newQuota")}</DialogTitle>
        </DialogHeader>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "12px 14px" }}>
          <Field label={t("board.quotas.kafka.appliesTo")}>
            <SelectField
              value={entity.type}
              options={entityTypes.map((type) => ({ value: type }))}
              onValueChange={(next) => setEntity({ type: next })}
            />
          </Field>
          <Field label={t("board.quotas.kafka.name")}>
            <Input
              className="mono3"
              disabled={entity.isDefault}
              value={entity.name}
              placeholder={entity.isDefault ? t("board.quotas.kafka.everyone") : "alice"}
              onChange={(event) => setEntity({ name: event.target.value })}
            />
          </Field>
        </div>

        <Field label={t("board.quotas.kafka.isDefault")} hint={t("board.quotas.kafka.isDefaultHint")}>
          <Switch
            checked={entity.isDefault}
            onCheckedChange={(next) => setEntity({ isDefault: next })}
          />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
          {limits.map((key) => (
            <Field key={key} label={key}>
              <Input
                className="mono3"
                value={draft.limits[key] ?? ""}
                placeholder={t("board.quotas.kafka.noLimit")}
                onChange={(event) => setLimit(key, event.target.value)}
              />
            </Field>
          ))}
        </div>

        {/* Said before the attempt, because "no limit" and "limit of zero" are
            a keystroke apart and one of them stops the client entirely. */}
        <WarnBanner>{t("board.quotas.kafka.zeroNote")}</WarnBanner>

        <DialogFooter className="items-center">
          <span className="flex-1" />
          {problem != null && (
            <span className="max-w-64 text-right text-xs text-muted-foreground">
              {t(`board.quotas.kafka.invalid.${problem}`)}
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
