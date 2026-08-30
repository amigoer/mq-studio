import { useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components";
import { copyText } from "@/api/platform";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import type { ConfigDocument } from "@/api/cluster";
import type { BrokerData } from "@/hooks/useBrokerData";

/**
 * A node's effective settings, as the node reports them.
 *
 * Read-only on purpose. A broker answers with four hundred keys and the
 * protocol will take an update for any of them, but what a given key does to a
 * running broker is not something this page can tell the reader, so it shows
 * what is running and leaves changing it to a deliberate act elsewhere.
 *
 * The search box is not a nicety at this size: nobody scrolls four hundred
 * rows, they arrive knowing which key they came for.
 */
export function ConfigDialog({
  open,
  title,
  subtitle,
  state,
  onClose,
}: {
  open: boolean;
  title: string;
  /** Which node answered, so a dialog opened from a list says so. */
  subtitle?: string;
  state: BrokerData<ConfigDocument>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [query, setQuery] = useState("");

  const rows = useMemo<[string, string][]>(() => {
    const entries: [string, string][] = Object.entries(state.data ?? {}).map(
      ([key, value]) => [key, value ?? ""],
    );
    const needle = query.trim().toLowerCase();
    const matched =
      needle === ""
        ? entries
        : entries.filter(
            ([key, value]) =>
              key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle),
          );
    return matched.sort(([left], [right]) => left.localeCompare(right));
  }, [query, state.data]);

  const total = Object.keys(state.data ?? {}).length;

  const copy = async () => {
    const text = rows.map(([key, value]) => `${key}=${value}`).join("\n");
    try {
      await copyText(text);
      toast.success(t("board.cluster.rocketmq.config.copied", { count: rows.length }));
    } catch {
      toast.error(t("board.cluster.rocketmq.config.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[660px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {subtitle != null && (
          <div className="mono3 -mt-2 text-xs text-(--c-muted)">{subtitle}</div>
        )}

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("board.cluster.rocketmq.config.search")}
        />

        <div className="flex max-h-[52vh] min-h-[180px] flex-col overflow-auto rounded-lg border">
          {isBlocked(state) ? (
            <BoardState state={state} />
          ) : rows.length === 0 ? (
            <Notice
              title={t(
                total === 0
                  ? "board.cluster.rocketmq.config.empty"
                  : "board.common.noMatch",
              )}
            />
          ) : (
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.cluster.rocketmq.config.key")}</TableHead>
                  <TableHead>{t("board.cluster.rocketmq.config.value")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(([key, value]) => (
                  <TableRow key={key}>
                    <TableCell className="mono3 align-top">{key}</TableCell>
                    <TableCell className="mono3 break-all text-(--c-mono-dim)">
                      {value === "" ? "—" : value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-(--c-muted)">
            {t("board.cluster.rocketmq.config.count", { shown: rows.length, total })}
          </span>
          <Button variant="outline" disabled={rows.length === 0} onClick={() => void copy()}>
            {t("board.common.copy")}
          </Button>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
