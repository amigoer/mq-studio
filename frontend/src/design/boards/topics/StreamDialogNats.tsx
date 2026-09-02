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
import type { StreamInput } from "@/api/nats";
import {
  emptyStreamDraft,
  streamDraftError,
  toStreamDraft,
  toStreamInput,
  type StreamDraft,
} from "./streamDraftNats";
import type { Destination } from "@bindings/model/models";

const GRID = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px",
} as const;

/**
 * Declaring a stream, or rewriting one.
 *
 * One dialog for both, because it is one form: what differs is which call the
 * server will accept, not what the user is asked for. Editing locks the name -
 * a stream cannot be renamed, and a field that looked editable and silently
 * declared a second stream would be the worst version of that.
 *
 * Storage is locked on an edit too, and that one is the server's rule rather
 * than this dialog's: it refuses a change of storage on a stream that exists,
 * because moving a file-backed stream into memory would mean deciding what to
 * do with what is already on disk.
 */
export function StreamDialogNats({
  open,
  onOpenChange,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stream being rewritten, or null when declaring a new one. */
  editing: Destination | null;
  onSubmit: (input: StreamInput, update: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<StreamDraft>(emptyStreamDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing != null ? toStreamDraft(editing) : emptyStreamDraft());
    setError(null);
  }, [editing, open]);

  const set = <K extends keyof StreamDraft>(key: K, value: StreamDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const update = editing != null;
  const invalid = streamDraftError(draft);

  const submit = async () => {
    if (invalid != null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toStreamInput(draft), update);
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
            {update ? t("board.topics.nats.editStream") : t("board.topics.nats.newStream")}
          </DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <div style={GRID}>
            <Field>
              <FieldLabel htmlFor="nats-stream-name">{t("board.topics.nats.stream")}</FieldLabel>
              <Input
                id="nats-stream-name"
                className="mono3"
                value={draft.name}
                placeholder="ORDERS"
                disabled={update}
                onChange={(event) => set("name", event.target.value)}
              />
              <FieldDescription>
                {update
                  ? t("board.topics.nats.nameLocked")
                  : t("board.topics.nats.nameHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-stream-replicas">
                {t("board.topics.nats.replicas")}
              </FieldLabel>
              <Input
                id="nats-stream-replicas"
                type="number"
                min={1}
                max={5}
                value={String(draft.replicas)}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  set("replicas", Number.isNaN(parsed) ? 1 : parsed);
                }}
              />
              <FieldDescription>{t("board.topics.nats.replicasHint")}</FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="nats-stream-subjects">
              {t("board.topics.nats.subjects")}
            </FieldLabel>
            <Input
              id="nats-stream-subjects"
              className="mono3"
              value={draft.subjects}
              placeholder="orders.created, orders.shipped"
              onChange={(event) => set("subjects", event.target.value)}
            />
            <FieldDescription>{t("board.topics.nats.subjectsHint")}</FieldDescription>
          </Field>

          <div style={GRID}>
            <Field>
              <FieldLabel>{t("board.topics.nats.retention")}</FieldLabel>
              <SelectField<string>
                value={draft.retention}
                options={[
                  { value: "limits", label: t("board.topics.nats.retentionLimits") },
                  { value: "interest", label: t("board.topics.nats.retentionInterest") },
                  { value: "workqueue", label: t("board.topics.nats.retentionWorkQueue") },
                ]}
                onValueChange={(value) => set("retention", value)}
              />
              <FieldDescription>
                {draft.retention === "workqueue"
                  ? t("board.topics.nats.retentionWorkQueueHint")
                  : t("board.topics.nats.retentionHint")}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("board.topics.nats.storage")}</FieldLabel>
              <SelectField<string>
                value={draft.storage}
                disabled={update}
                options={[
                  { value: "file", label: t("board.topics.nats.storageFile") },
                  { value: "memory", label: t("board.topics.nats.storageMemory") },
                ]}
                onValueChange={(value) => set("storage", value)}
              />
              <FieldDescription>
                {update
                  ? t("board.topics.nats.storageLocked")
                  : t("board.topics.nats.storageHint")}
              </FieldDescription>
            </Field>
          </div>

          <div style={GRID}>
            <Field>
              <FieldLabel>{t("board.topics.nats.discard")}</FieldLabel>
              <SelectField<string>
                value={draft.discard}
                options={[
                  { value: "old", label: t("board.topics.nats.discardOld") },
                  { value: "new", label: t("board.topics.nats.discardNew") },
                ]}
                onValueChange={(value) => set("discard", value)}
              />
              <FieldDescription>{t("board.topics.nats.discardHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-stream-maxage">
                {t("board.topics.nats.maxAge")}
              </FieldLabel>
              <Input
                id="nats-stream-maxage"
                className="mono3"
                value={draft.maxAge}
                placeholder="24h"
                onChange={(event) => set("maxAge", event.target.value)}
              />
              <FieldDescription>{t("board.topics.nats.maxAgeHint")}</FieldDescription>
            </Field>
          </div>

          <div style={GRID}>
            <Field>
              <FieldLabel htmlFor="nats-stream-maxmsgs">
                {t("board.topics.nats.maxMessages")}
              </FieldLabel>
              <Input
                id="nats-stream-maxmsgs"
                className="mono3"
                value={draft.maxMsgs}
                placeholder={t("board.topics.nats.unlimited")}
                onChange={(event) => set("maxMsgs", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nats-stream-maxbytes">
                {t("board.topics.nats.maxBytes")}
              </FieldLabel>
              <Input
                id="nats-stream-maxbytes"
                className="mono3"
                value={draft.maxBytes}
                placeholder={t("board.topics.nats.unlimited")}
                onChange={(event) => set("maxBytes", event.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>{t("board.topics.nats.protection")}</FieldLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <SwitchRow
                checked={draft.denyDelete}
                onChange={(value) => set("denyDelete", value)}
                label={t("board.topics.nats.flagDenyDelete")}
              />
              <SwitchRow
                checked={draft.denyPurge}
                onChange={(value) => set("denyPurge", value)}
                label={t("board.topics.nats.flagDenyPurge")}
              />
            </div>
            <FieldDescription>{t("board.topics.nats.protectionHint")}</FieldDescription>
          </Field>

          {invalid != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>
              {t(`board.topics.nats.error.${invalid}`)}
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

function SwitchRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11.5px" }}>
      <Switch checked={checked} onCheckedChange={onChange} />
      <span style={{ color: "var(--c-muted)" }}>{label}</span>
    </span>
  );
}
