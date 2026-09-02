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
import { Spinner } from "@/components/ui/spinner";
import { Segmented } from "@/components";
import { formatErrorMessage } from "@/lib/utils";
import type { PurgeInput } from "@/api/nats";

export type PurgeStrategy = "maxlen" | "minid";

/**
 * What the purge dialog will send, or null when it cannot be sent.
 *
 * Exported because it is the whole of what this form can get wrong, and the
 * two mistakes it prevents are both quiet ones. A blank keep-count is not
 * zero: zero empties the stream, and a form that treated an untouched field as
 * "keep none" would be the most destructive default in the app. And a
 * sequence is one number for the whole stream, so an entry id in another
 * family's shape has to be refused here rather than at the server.
 */
export function purgeInputOf(
  stream: string,
  strategy: PurgeStrategy,
  keep: string,
  sequence: string,
): PurgeInput | null {
  if (strategy === "maxlen") {
    const trimmed = keep.trim();
    if (trimmed === "") return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed < 0 || String(parsed) !== trimmed) return null;
    return { stream, strategy, keep: parsed, sequence: "" } as PurgeInput;
  }
  const trimmed = sequence.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return { stream, strategy, keep: 0, sequence: trimmed } as PurgeInput;
}

/**
 * Discarding messages from the head of a stream.
 *
 * Two ways of naming a bound, because they answer different questions. Keeping
 * the newest N is what somebody reclaiming disk asks for and lets however many
 * messages that takes go; keeping everything from a sequence is what somebody
 * dropping everything before an incident asks for, and lets however many that
 * takes go. Neither can be written as the other.
 *
 * There is no separate "empty this stream" control, and that is deliberate:
 * keeping none is one setting of the first bound, and offering both would be
 * two controls for one command.
 */
export function PurgeDialogNats({
  stream,
  open,
  onOpenChange,
  onPurge,
}: {
  stream: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurge: (input: PurgeInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [strategy, setStrategy] = useState<PurgeStrategy>("maxlen");
  const [keep, setKeep] = useState("");
  const [sequence, setSequence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStrategy("maxlen");
    setKeep("");
    setSequence("");
    setError(null);
  }, [open]);

  const submitted = stream == null ? null : purgeInputOf(stream, strategy, keep, sequence);

  const submit = async () => {
    if (submitted == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onPurge(submitted);
      onOpenChange(false);
    } catch (purgeError) {
      setError(formatErrorMessage(purgeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.nats.purgeTitle", { name: stream ?? "" })}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.topics.nats.purgeStrategy")}</FieldLabel>
            <Segmented<PurgeStrategy>
              style={{ alignSelf: "flex-start" }}
              value={strategy}
              options={[
                { value: "maxlen", label: t("board.topics.nats.purgeKeep") },
                { value: "minid", label: t("board.topics.nats.purgeFrom") },
              ]}
              onChange={setStrategy}
            />
          </Field>

          {strategy === "maxlen" ? (
            <Field>
              <FieldLabel htmlFor="nats-purge-keep">
                {t("board.topics.nats.purgeKeepLabel")}
              </FieldLabel>
              <Input
                id="nats-purge-keep"
                className="mono3"
                value={keep}
                placeholder="1000"
                onChange={(event) => setKeep(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              <FieldDescription>
                {/* Zero has to be spelled out. It is the only purge JetStream
                    has, and somebody looking for an "empty" button needs to be
                    told this is it. */}
                {keep.trim() === "0"
                  ? t("board.topics.nats.purgeKeepZero")
                  : t("board.topics.nats.purgeKeepHint")}
              </FieldDescription>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="nats-purge-seq">
                {t("board.topics.nats.purgeFromLabel")}
              </FieldLabel>
              <Input
                id="nats-purge-seq"
                className="mono3"
                value={sequence}
                placeholder="1000"
                onChange={(event) => setSequence(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              <FieldDescription>{t("board.topics.nats.purgeFromHint")}</FieldDescription>
            </Field>
          )}

          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={submitted == null || busy}
            onClick={() => void submit()}
          >
            {busy && <Spinner className="size-3.5" />}
            {t("board.topics.nats.purge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
