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
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { SelectField } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { NATSConsumerInput } from "@bindings/bridge/models";
import type { Subscription } from "@bindings/model/models";
import {
  consumerDraftError,
  emptyConsumerDraft,
  toConsumerDraft,
  toConsumerInput,
  type ConsumerDraft,
} from "./consumerDraftNats";

const GRID = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" } as const;

/**
 * Declaring a consumer, or rewriting one.
 *
 * Where it starts reading is set once and never again: the server refuses to
 * change a consumer's delivery policy after it exists, which is why this app
 * offers no offset reset for NATS at all. On an edit the control is locked and
 * says so, rather than being offered and refused.
 */
export function ConsumerDialogNats({
  open,
  onOpenChange,
  stream,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stream a new consumer will be declared on. */
  stream: string;
  editing: Subscription | null;
  onSubmit: (input: NATSConsumerInput, update: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ConsumerDraft>(() => emptyConsumerDraft(stream));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing != null ? toConsumerDraft(editing) : emptyConsumerDraft(stream));
    setError(null);
  }, [editing, open, stream]);

  const set = <K extends keyof ConsumerDraft>(key: K, value: ConsumerDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const update = editing != null;
  const invalid = consumerDraftError(draft);
  const push = draft.deliverSubject.trim() !== "";

  const submit = async () => {
    if (invalid != null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toConsumerInput(draft), update);
      onOpenChange(false);
    } catch (submitError) {
      setError(formatErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>
            {update
              ? t("board.consumers.nats.editConsumer")
              : t("board.consumers.nats.newConsumer", { stream: draft.stream })}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div style={GRID}>
            <Field>
              <FieldLabel htmlFor="nats-consumer-name">
                {t("board.consumers.nats.name")}
              </FieldLabel>
              <Input
                id="nats-consumer-name"
                className="mono3"
                value={draft.name}
                placeholder="worker"
                disabled={update}
                onChange={(event) => set("name", event.target.value)}
              />
              <FieldDescription>
                {update
                  ? t("board.consumers.nats.nameLocked")
                  : t("board.consumers.nats.nameHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("board.consumers.nats.startAt")}</FieldLabel>
              <SelectField<string>
                value={draft.deliverPolicy}
                disabled={update}
                options={[
                  { value: "all", label: t("board.consumers.nats.startAll") },
                  { value: "new", label: t("board.consumers.nats.startNew") },
                  { value: "last", label: t("board.consumers.nats.startLast") },
                  {
                    value: "lastPerSubject",
                    label: t("board.consumers.nats.startLastPerSubject"),
                  },
                ]}
                onValueChange={(value) => set("deliverPolicy", value)}
              />
              <FieldDescription>
                {update
                  ? t("board.consumers.nats.startLocked")
                  : t("board.consumers.nats.startHint")}
              </FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="nats-consumer-filter">
              {t("board.consumers.nats.filter")}
            </FieldLabel>
            <Input
              id="nats-consumer-filter"
              className="mono3"
              value={draft.filterSubject}
              placeholder={t("board.consumers.nats.filterPlaceholder")}
              onChange={(event) => set("filterSubject", event.target.value)}
            />
            <FieldDescription>{t("board.consumers.nats.filterHint")}</FieldDescription>
          </Field>

          <div style={GRID}>
            <Field>
              <FieldLabel>{t("board.consumers.nats.ackPolicy")}</FieldLabel>
              <SelectField<string>
                value={draft.ackPolicy}
                options={[
                  { value: "explicit", label: t("board.consumers.nats.ackExplicit") },
                  { value: "all", label: t("board.consumers.nats.ackAll") },
                  { value: "none", label: t("board.consumers.nats.ackNone") },
                ]}
                onValueChange={(value) => set("ackPolicy", value)}
              />
              <FieldDescription>
                {draft.ackPolicy === "none"
                  ? t("board.consumers.nats.ackNoneHint")
                  : t("board.consumers.nats.ackHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-consumer-ackwait">
                {t("board.consumers.nats.ackWait")}
              </FieldLabel>
              <Input
                id="nats-consumer-ackwait"
                className="mono3"
                value={draft.ackWait}
                placeholder="30s"
                onChange={(event) => set("ackWait", event.target.value)}
              />
              <FieldDescription>{t("board.consumers.nats.ackWaitHint")}</FieldDescription>
            </Field>
          </div>

          <div style={GRID}>
            <Field>
              <FieldLabel htmlFor="nats-consumer-maxdeliver">
                {t("board.consumers.nats.maxDeliver")}
              </FieldLabel>
              <Input
                id="nats-consumer-maxdeliver"
                className="mono3"
                value={draft.maxDeliver}
                placeholder={t("board.consumers.nats.unlimited")}
                onChange={(event) => set("maxDeliver", event.target.value)}
              />
              {/* The consequence is the whole point of the field: JetStream has
                  no dead-letter queue, so a message that runs out of attempts
                  is not moved anywhere. It stops being redelivered and only an
                  advisory says so. */}
              <FieldDescription>{t("board.consumers.nats.maxDeliverHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-consumer-maxack">
                {t("board.consumers.nats.maxAckPending")}
              </FieldLabel>
              <Input
                id="nats-consumer-maxack"
                className="mono3"
                value={draft.maxAckPending}
                placeholder="1000"
                onChange={(event) => set("maxAckPending", event.target.value)}
              />
              <FieldDescription>{t("board.consumers.nats.maxAckPendingHint")}</FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="nats-consumer-deliver">
              {t("board.consumers.nats.deliverSubject")}
            </FieldLabel>
            <Input
              id="nats-consumer-deliver"
              className="mono3"
              value={draft.deliverSubject}
              placeholder={t("board.consumers.nats.pullPlaceholder")}
              onChange={(event) => set("deliverSubject", event.target.value)}
            />
            <FieldDescription>{t("board.consumers.nats.deliverSubjectHint")}</FieldDescription>
          </Field>

          {push && (
            <Field>
              <FieldLabel htmlFor="nats-consumer-group">
                {t("board.consumers.nats.deliverGroup")}
              </FieldLabel>
              <Input
                id="nats-consumer-group"
                className="mono3"
                value={draft.deliverGroup}
                onChange={(event) => set("deliverGroup", event.target.value)}
              />
              <FieldDescription>{t("board.consumers.nats.deliverGroupHint")}</FieldDescription>
            </Field>
          )}

          <Field>
            <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px" }}>
              <Switch
                checked={draft.durable}
                disabled={update}
                onCheckedChange={(value: boolean) => set("durable", value)}
              />
              <span style={{ color: "var(--c-muted)" }}>
                {t("board.consumers.nats.durable")}
              </span>
            </span>
            <FieldDescription>{t("board.consumers.nats.durableHint")}</FieldDescription>
          </Field>

          {invalid != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>
              {t(`board.consumers.nats.error.${invalid}`)}
            </FieldDescription>
          )}
          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button disabled={invalid != null || busy} onClick={() => void submit()}>
            {busy && <Spinner className="size-3.5" />}
            {update ? t("board.common.save") : t("board.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
