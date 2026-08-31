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
import { KV, WarnBanner, useToast } from "@/components";
import { reassignKafkaPartition } from "@/api/kafka";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import {
  emptyReassignDraft,
  isUnchanged,
  parseBrokerList,
  validateReassignDraft,
  type ReassignDraft,
} from "./reassignDraft";

/**
 * Moving one partition to a different set of brokers.
 *
 * One partition at a time, not a whole-topic plan. A topic-wide reassignment is
 * a capacity exercise with a throttle and a rollback, and doing it a partition
 * at a time from a dialog would be the slowest possible way to run one. What
 * this is for is the case an operator actually meets: one partition on the
 * wrong broker after a failure.
 */
export function ReassignDialogKafka({
  open,
  topic,
  partition,
  replicas,
  clusterBrokers,
  onClose,
  onReassigned,
}: {
  open: boolean;
  topic: string;
  partition: number;
  replicas: readonly number[];
  clusterBrokers: readonly number[];
  onClose: () => void;
  onReassigned: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const [draft, setDraft] = useState<ReassignDraft>(() => emptyReassignDraft(replicas));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(emptyReassignDraft(replicas));
  }, [open, replicas]);

  const problem = validateReassignDraft(draft, clusterBrokers);
  const unchanged = problem == null && isUnchanged(draft, replicas);

  const save = async () => {
    if (problem != null || unchanged) return;
    const brokers = parseBrokerList(draft.brokers);
    if (brokers == null) return;
    setSaving(true);
    try {
      await reassignKafkaPartition(connID, topic, partition, brokers);
      toast.success(t("board.topics.kafka.reassignStarted", { partition }));
      onReassigned();
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
          <DialogTitle>{t("board.topics.kafka.reassignTitle", { topic, partition })}</DialogTitle>
        </DialogHeader>

        <KV
          rows={[
            [t("board.topics.kafka.currently"), replicas.join(", ") || "—"],
            [t("board.topics.kafka.clusterBrokers"), clusterBrokers.join(", ")],
          ]}
        />

        <div className="flex min-w-0 flex-col gap-1.5 text-xs">
          <span className="font-medium">
            {t("board.topics.kafka.newReplicas")}{" "}
            <span className="font-normal text-(--c-muted-2)">
              {t("board.topics.kafka.newReplicasHint")}
            </span>
          </span>
          <Input
            className="mono3"
            value={draft.brokers}
            placeholder="1, 2, 3"
            onChange={(event) => setDraft({ brokers: event.target.value })}
          />
        </div>

        {/* Said before the attempt, because the cost is not obvious: the
            cluster copies the whole log to its new home, and there is no
            completion event to wait for. */}
        <WarnBanner>{t("board.topics.kafka.reassignNote")}</WarnBanner>

        <DialogFooter className="items-center">
          <span className="flex-1" />
          {(problem != null || unchanged) && (
            <span className="max-w-64 text-right text-xs text-muted-foreground">
              {unchanged
                ? t("board.topics.kafka.invalid.unchanged")
                : t(`board.topics.kafka.invalid.${problem}`)}
            </span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={problem != null || unchanged || saving} onClick={() => void save()}>
            {saving && <Spinner />}
            {t("board.topics.kafka.reassign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
