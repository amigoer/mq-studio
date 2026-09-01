import { useCallback, useEffect, useState } from "react";
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
import { Segmented, SelectField } from "@/components";
import { useBrokerData } from "@/hooks/useBrokerData";
import * as clusterApi from "@/api/cluster";
import { BrokerRole, brokerId, brokerName, role } from "@/mq/rocketmq/nodes";
import { ConsumeMode, broadcastEnabled, groupName, maxRetry } from "@/mq/rocketmq/subscriptions";
import type { Subscription } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** Every master, which is where a consumer group normally has to exist. */
const ALL_MASTERS = "";

/* A Select item cannot carry the empty string, so "all masters" gets a
   sentinel at the widget boundary and stays "" in the form. */
const ALL_MASTERS_OPTION = "__all_masters__";

/** RocketMQ's own default, which is what the broker uses when asked for none. */
const DEFAULT_MAX_RETRY = 16;

export interface ConsumerGroupForm {
  group: string;
  brokerAddr: string;
  /** ConsumeMode.Broadcasting means consumeBroadcastEnable, not the mode in use. */
  consumeMode: string;
  maxRetry: number;
}

/**
 * The form a group opens with, or a blank one for a create.
 *
 * Exported because the edit case is the one that can lose data silently: an
 * update rewrites the whole subscription config, so whatever this returns for
 * a field the user never touches is what gets written back.
 */
export function formOf(group: Subscription | undefined): ConsumerGroupForm {
  if (group == null) {
    return {
      group: "",
      brokerAddr: ALL_MASTERS,
      consumeMode: ConsumeMode.Clustering,
      maxRetry: DEFAULT_MAX_RETRY,
    };
  }
  return {
    group: groupName(group),
    brokerAddr: ALL_MASTERS,
    /* The stored permission, not what a client reports: an update rewrites the
       whole subscription config, so anything guessed here is silently written. */
    consumeMode: broadcastEnabled(group) ? ConsumeMode.Broadcasting : ConsumeMode.Clustering,
    maxRetry: maxRetry(group) > 0 ? maxRetry(group) : DEFAULT_MAX_RETRY,
  };
}

/** RocketMQ stores the retry count as an int; the broker refuses a negative. */
export const clampRetries = (value: number): number => Math.max(0, Math.min(1000, value));

/** The reason the form cannot be saved, or null. */
export function validate(
  form: ConsumerGroupForm,
  t: (key: string) => string,
): string | null {
  if (form.group.trim() === "") return t("board.consumers.rocketmq.form.nameRequired");
  // A group name reaches the broker inside a retry topic name (%RETRY%<group>),
  // so a space or a percent there is a name that cannot round-trip.
  if (/[\s%]/.test(form.group)) return t("board.consumers.rocketmq.form.nameInvalid");
  return null;
}

/**
 * Create or edit a consumer group.
 *
 * RocketMQ has no separate update command - the broker upserts whatever
 * subscription config it is handed - so editing reuses the form and only locks
 * the name, the same shape the topic dialog has.
 *
 * This was removed while rocketmq-admin-go sent the config in extFields, where
 * RocketMQ 5.x reads it from the request body: every create came back as a
 * NullPointerException. The library sends a body now.
 */
export function ConsumerGroupDialog({
  open,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Set to edit an existing group instead of creating one. */
  editing?: Subscription;
  onClose: () => void;
  onSubmit: (form: ConsumerGroupForm) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ConsumerGroupForm>(() => formOf(editing));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brokers = useBrokerData(
    useCallback((id: number) => clusterApi.getBrokers(id), []),
    { enabled: open, refreshMs: null },
  );
  const masters = (brokers.data ?? []).filter((node) => role(node) === BrokerRole.Master);

  useEffect(() => {
    if (!open) return;
    setForm(formOf(editing));
    setError(null);
    setSaving(false);
  }, [editing, open]);

  const set = <K extends keyof ConsumerGroupForm>(key: K, value: ConsumerGroupForm[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const retryCount = (raw: string) => clampRetries(Number(raw) || 0);
  const invalid = validate(form, t);

  const save = async () => {
    if (invalid != null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, group: form.group.trim() });
      onClose();
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>
            {t(
              editing != null
                ? "board.consumers.rocketmq.form.editTitle"
                : "board.consumers.rocketmq.form.newTitle",
            )}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup className="grid grid-cols-2 gap-x-3.5 gap-y-3">
          <Field className="col-span-2">
            <FieldLabel htmlFor="group-name">
              {t("board.consumers.rocketmq.form.nameLabel")}
            </FieldLabel>
            <Input
              id="group-name"
              className="mono3"
              value={form.group}
              placeholder="ORDER_CONSUMER"
              /* The name is the identity: renaming would create a second group
                 and leave the first behind with its offsets. */
              disabled={editing != null}
              onChange={(event) => set("group", event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="group-max-retry">
              {t("board.consumers.rocketmq.form.maxRetryLabel")}
            </FieldLabel>
            <Input
              id="group-max-retry"
              value={String(form.maxRetry)}
              onChange={(event) => set("maxRetry", retryCount(event.target.value))}
            />
          </Field>

          <Field>
            <FieldLabel>{t("board.consumers.rocketmq.form.broadcastLabel")}</FieldLabel>
            <Segmented
              className="self-start"
              value={form.consumeMode}
              onChange={(next: string) => set("consumeMode", next)}
              options={[
                {
                  value: ConsumeMode.Clustering as string,
                  label: t("board.consumers.rocketmq.form.clustering"),
                },
                {
                  value: ConsumeMode.Broadcasting as string,
                  label: t("board.consumers.rocketmq.form.broadcasting"),
                },
              ]}
            />
          </Field>

          <Field className="col-span-2">
            <FieldLabel>
              Broker{" "}
              <span className="font-normal text-muted-foreground">
                {t("board.consumers.rocketmq.form.brokerHint")}
              </span>
            </FieldLabel>
            <SelectField
              size="default"
              className="w-full"
              value={form.brokerAddr === ALL_MASTERS ? ALL_MASTERS_OPTION : form.brokerAddr}
              onValueChange={(next) =>
                set("brokerAddr", next === ALL_MASTERS_OPTION ? ALL_MASTERS : next)
              }
              options={[
                {
                  value: ALL_MASTERS_OPTION,
                  label: t("board.consumers.rocketmq.form.allMasters", { count: masters.length }),
                },
                ...masters.map((node) => ({
                  value: node.address,
                  label: `${brokerName(node)}${brokerId(node) !== 0 ? `-${brokerId(node)}` : ""} · ${node.address}`,
                })),
              ]}
            />
          </Field>
        </FieldGroup>

        <FieldDescription className="text-xs">
          {t("board.consumers.rocketmq.form.broadcastNote")}
        </FieldDescription>

        <DialogFooter className="items-center">
          {(invalid ?? error) != null && (
            <span
              className={
                "max-w-80 text-right text-xs " +
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
