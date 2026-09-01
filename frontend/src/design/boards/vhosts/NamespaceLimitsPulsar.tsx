import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components";
import type { Namespace } from "@/api/pulsar";
import {
  LimitMaxConsumersPerSubscription,
  LimitMaxConsumersPerTopic,
  LimitMaxProducersPerTopic,
  LimitMessageTTLSeconds,
  LimitRetentionSizeMB,
  LimitRetentionTimeMinutes,
  NAMESPACE_LIMITS,
  limit,
} from "@/mq/pulsar/namespaces";

/** The label key each limit draws, so the panel names them in the user's own words. */
const LABELS: Record<string, string> = {
  [LimitMessageTTLSeconds]: "board.vhosts.pulsar.limitMessageTtl",
  [LimitRetentionTimeMinutes]: "board.vhosts.pulsar.limitRetentionTime",
  [LimitRetentionSizeMB]: "board.vhosts.pulsar.limitRetentionSize",
  [LimitMaxProducersPerTopic]: "board.vhosts.pulsar.limitMaxProducers",
  [LimitMaxConsumersPerTopic]: "board.vhosts.pulsar.limitMaxConsumers",
  [LimitMaxConsumersPerSubscription]: "board.vhosts.pulsar.limitMaxConsumersPerSub",
};

/**
 * A limit the form is willing to submit, or the reason it will not.
 *
 * Exported so the rule is testable without a DOM. Pulsar takes an int and
 * refuses a negative one; a blank field is not a zero but a request to hand
 * the limit back to the broker, which is a different call.
 */
export function parseLimit(raw: string): { value: number } | { error: "blank" | "invalid" } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "blank" };
  const value = Number.parseInt(trimmed, 10);
  if (Number.isNaN(value) || value < 0 || String(value) !== trimmed) return { error: "invalid" };
  return { value };
}

/**
 * The limits panel for one namespace.
 *
 * Each row is its own call, and clearing a row is a different call from
 * setting it to zero. That distinction is the whole point of the panel: an
 * absent limit is the broker's own setting deciding, and a zero is a namespace
 * capped at nothing. Collapsing them would let an operator turn off publishing
 * by clearing a field.
 *
 * Retention is the one exception and says so: Pulsar stores the pair as one
 * policy, so clearing either half clears both.
 */
export function NamespaceLimitsPulsar({
  namespace,
  onSet,
  onRemove,
}: {
  namespace: Namespace;
  onSet: (limit: string, value: number) => Promise<void>;
  onRemove: (limit: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDrafts({});
  }, [namespace.name]);

  const shown = (key: string): string => {
    const draft = drafts[key];
    if (draft != null) return draft;
    const current = limit(namespace, key);
    return current == null ? "" : String(current);
  };

  const apply = async (key: string) => {
    const parsed = parseLimit(shown(key));
    setBusy(key);
    try {
      if ("error" in parsed) {
        // A cleared field hands the limit back to the broker rather than
        // storing a zero, which would be a cap of nothing.
        if (parsed.error === "blank") await onRemove(key);
        return;
      }
      await onSet(key, parsed.value);
    } finally {
      setBusy(null);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <>
      <SectionLabel>{t("board.vhosts.pulsar.limits")}</SectionLabel>
      <p className="text-xs text-muted-foreground">{t("board.vhosts.pulsar.limitsHint")}</p>
      <div className="flex flex-col gap-2">
        {NAMESPACE_LIMITS.map((key) => {
          const parsed = parseLimit(shown(key));
          const invalid = "error" in parsed && parsed.error === "invalid";
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="flex-1">{t(LABELS[key] ?? key)}</span>
              <Input
                className="mono3 h-7 w-28"
                value={shown(key)}
                placeholder={t("board.vhosts.pulsar.uncapped")}
                aria-invalid={invalid}
                onChange={(event) =>
                  setDrafts((previous) => ({ ...previous, [key]: event.target.value }))
                }
              />
              <Button
                size="xs"
                variant="outline"
                disabled={invalid || busy === key}
                onClick={() => void apply(key)}
              >
                {t("common.save")}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("board.vhosts.pulsar.retentionNote")}</p>
    </>
  );
}
