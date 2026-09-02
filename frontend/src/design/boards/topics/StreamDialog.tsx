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
import { formatErrorMessage } from "@/lib/utils";

/**
 * The key a submission carries, or null when there is nothing to submit.
 *
 * Exported because it is the only rule this form has, and the only thing it
 * can get wrong: a key with surrounding whitespace is a different key, and
 * Redis would accept it without a word.
 */
export function streamKeyOf(typed: string): string | null {
  const key = typed.trim();
  return key === "" ? null : key;
}

/**
 * A key, and nothing else.
 *
 * Every other family's create dialog collects settings because its
 * destinations have some. A Redis stream has none: no partition count, no
 * retention, no durability, no bound. Offering a field here that the server
 * would ignore is the mistake this dialog exists to not make.
 */
export function StreamDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (key: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setError(null);
    }
  }, [open]);

  const submitted = streamKeyOf(key);

  const submit = async () => {
    if (submitted == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(submitted);
      onOpenChange(false);
    } catch (createError) {
      setError(formatErrorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("board.topics.redis.newStream")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="redis-stream-key">
              {t("board.topics.redis.streamKey")}
            </FieldLabel>
            <Input
              id="redis-stream-key"
              className="mono3"
              value={key}
              placeholder="orders:events"
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <FieldDescription>{t("board.topics.redis.newStreamHint")}</FieldDescription>
          </Field>
          {error != null && (
            <FieldDescription style={{ color: "var(--c-err)" }}>{error}</FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("board.common.cancel")}
          </Button>
          <Button disabled={submitted == null || busy} onClick={() => void submit()}>
            {busy && <Spinner className="size-3.5" />}
            {t("board.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
