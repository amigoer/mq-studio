import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Status } from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import * as clusterApi from "@/api/cluster";

/**
 * How far each follower of one broker trails it.
 *
 * "Is a replica falling behind" is the one thing a cluster page is opened to
 * answer during an incident, and it is the one thing the list cannot carry:
 * the broker answers it in a second request, per node, which a table
 * refreshing every thirty seconds should not pay for every row.
 *
 * A master with no followers and a follower asked about its own replicas both
 * answer with nothing, so an empty result is normal rather than a failure.
 */
export function ReplicaDialog({
  open,
  address,
  onClose,
}: {
  open: boolean;
  address: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const load = useCallback(
    (id: number) => clusterApi.getBrokerDetail(id, address ?? ""),
    [address],
  );
  const state = useBrokerData(load, { refreshMs: null, enabled: address != null });
  const replicas = state.data?.replicas ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("board.cluster.rocketmq.replicas.title")}</DialogTitle>
        </DialogHeader>

        <div className="mono3 -mt-2 text-xs text-(--c-muted)">{address}</div>

        <div className="flex min-h-[140px] flex-col overflow-hidden rounded-lg border">
          {isBlocked(state) ? (
            <BoardState state={state} />
          ) : replicas.length === 0 ? (
            <Notice title={t("board.cluster.rocketmq.replicas.none")}>
              {t("board.cluster.rocketmq.replicas.noneHint")}
            </Notice>
          ) : (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.address")}</TableHead>
                  <TableHead style={{ textAlign: "right" }}>
                    {t("board.cluster.rocketmq.replicas.behind")}
                  </TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replicas.map((replica) => (
                  <TableRow key={replica.address}>
                    <TableCell className="mono3">{replica.address}</TableCell>
                    <TableCell className="mono3" style={{ textAlign: "right" }}>
                      {replica.behindBytes < 0
                        ? "—"
                        : t("board.cluster.rocketmq.replicas.bytes", {
                            bytes: replica.behindBytes.toLocaleString(),
                          })}
                    </TableCell>
                    <TableCell>
                      <Status tone={replica.inSync ? "ok" : "warn"}>
                        {t(
                          replica.inSync
                            ? "board.cluster.rocketmq.replicas.inSync"
                            : "board.cluster.rocketmq.replicas.outOfSync",
                        )}
                      </Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
