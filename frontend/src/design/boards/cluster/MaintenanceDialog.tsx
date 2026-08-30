import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Panel, useConfirm, useToast } from "@/components";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as clusterApi from "@/api/cluster";
import type { MaintenanceTaskView } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/**
 * Housekeeping a broker would get to on its own schedule, run now.
 *
 * The task list comes from Go rather than being written here: it is a closed
 * set, each entry already carries whether it destroys message data, and a task
 * the renderer could name for itself would be one nobody reviewed.
 *
 * Everything here reclaims disk and none of it can be undone, so each task
 * confirms — and the one that deletes commit log past retention confirms as a
 * destructive action, which is a different dialog with a different button.
 */
export function MaintenanceDialog({
  open,
  address,
  onClose,
}: {
  open: boolean;
  /** The broker to run on. Null closes the dialog. */
  address: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();
  const toast = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<MaintenanceTaskView[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tasks.length > 0) return;
    void clusterApi.getMaintenanceTasks().then(setTasks).catch(() => setTasks([]));
  }, [open, tasks.length]);

  const run = async (task: MaintenanceTaskView) => {
    if (address == null) return;
    const name = t(`board.cluster.rocketmq.maintenance.task.${task.task}.name`);
    const confirmed = await confirm({
      title: name,
      description: t(
        task.destructive
          ? "board.cluster.rocketmq.maintenance.confirmDestructive"
          : "board.cluster.rocketmq.maintenance.confirm",
        { address },
      ),
      confirmLabel: t("board.cluster.rocketmq.maintenance.run"),
      danger: task.destructive,
    });
    if (!confirmed) return;

    setRunning(task.task);
    try {
      await clusterApi.runMaintenance(connID, address, task.task);
      toast.success(t("board.cluster.rocketmq.maintenance.done", { name }));
    } catch (failure) {
      toast.error(t("board.cluster.rocketmq.maintenance.failed", { name }), {
        description: formatErrorMessage(failure),
      });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("board.cluster.rocketmq.maintenance.title")}</DialogTitle>
        </DialogHeader>

        <div className="mono3 -mt-2 text-xs text-(--c-muted)">{address}</div>

        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <Panel key={task.task} className="flex items-start gap-3 p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {t(`board.cluster.rocketmq.maintenance.task.${task.task}.name`)}
                  {task.destructive && (
                    <TriangleAlert size={12} style={{ color: "var(--c-warn-text)" }} aria-hidden />
                  )}
                </div>
                <p className="m-0 text-xs leading-relaxed text-(--c-muted)">
                  {t(`board.cluster.rocketmq.maintenance.task.${task.task}.desc`)}
                </p>
              </div>
              <Button
                variant={task.destructive ? "destructive" : "outline"}
                size="xs"
                disabled={running != null}
                onClick={() => void run(task)}
              >
                {running === task.task && <Spinner />}
                {t("board.cluster.rocketmq.maintenance.run")}
              </Button>
            </Panel>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
