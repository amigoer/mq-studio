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
import { Spinner } from "@/components/ui/spinner";
import { KV, Panel, SelectField, Status } from "@/components";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as consumerApi from "@/api/consumer";
import * as messageApi from "@/api/message";
import type { ReplayResult } from "@/api/message";
import { clientsOf, groupName } from "@/mq/rocketmq/subscriptions";
import { formatErrorMessage } from "@/lib/utils";

/** The broker's own words for a handler that finished cleanly. */
const SUCCESS = "CONSUME_SUCCESS";

/**
 * Run one consumer's handler on one message, and show what it returned.
 *
 * It is the answer to "why does this message fail", which nothing else on the
 * page can give: a dead letter says a message was given up on, the trace says
 * which groups saw it, and neither says what the application did with it.
 *
 * A client is picked rather than a group because a group would hand the
 * message to whichever member the rebalance chose, and the question is about
 * one consumer. Only groups with something connected can answer, so the picker
 * is built from the clients each group reports.
 */
export function ReplayDialog({
  open,
  topic,
  messageId,
  onClose,
}: {
  open: boolean;
  topic: string;
  messageId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { id: connID } = useConnectionScope();

  const groups = useBrokerData(
    useCallback((id: number) => consumerApi.getConsumerGroups(id), []),
    { refreshMs: null, enabled: open },
  );
  const withClients = (groups.data ?? []).filter((group) => clientsOf(group).length > 0);

  const [group, setGroup] = useState("");
  const [client, setClient] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroup("");
    setClient("");
    setResult(null);
    setError(null);
    setRunning(false);
  }, [open, messageId]);

  const clients = clientsOf(
    withClients.find((candidate) => groupName(candidate) === group) ??
      ({ attributes: {} } as never),
  );

  const run = async () => {
    if (group === "" || client === "") return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await messageApi.replayMessage(connID, group, client, topic, messageId));
    } catch (failure) {
      setError(formatErrorMessage(failure));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("board.messages.rocketmq.replay.title")}</DialogTitle>
        </DialogHeader>

        <div className="mono3 -mt-2 text-xs text-(--c-muted)">{messageId}</div>

        {withClients.length === 0 ? (
          <p className="m-0 text-xs leading-relaxed text-(--c-muted)">
            {t("board.messages.rocketmq.replay.noClients")}
          </p>
        ) : (
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel>{t("board.common.consumerGroup")}</FieldLabel>
              <SelectField
                size="default"
                className="w-full"
                value={group}
                onValueChange={(next) => {
                  setGroup(next);
                  setClient("");
                  setResult(null);
                }}
                placeholder={t("board.messages.rocketmq.replay.pickGroup")}
                options={withClients.map((one) => ({ value: groupName(one) }))}
              />
            </Field>
            <Field>
              <FieldLabel>{t("board.messages.rocketmq.replay.client")}</FieldLabel>
              <SelectField
                size="default"
                className="w-full"
                value={client}
                onValueChange={setClient}
                placeholder={t("board.messages.rocketmq.replay.pickClient")}
                options={clients.map((one) => ({ value: one.clientId }))}
              />
            </Field>
          </FieldGroup>
        )}

        {result != null && (
          <Panel className="flex flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              <Status tone={result.result === SUCCESS ? "ok" : "err"}>
                {result.result || "—"}
              </Status>
              <span className="text-xs text-(--c-muted)">
                {t("board.messages.rocketmq.replay.spent", { ms: result.spentMs })}
              </span>
            </div>
            {result.remark !== "" && (
              <pre className="mono3 m-0 max-h-40 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap text-(--c-err-text)">
                {result.remark}
              </pre>
            )}
            <KV
              rows={[
                [
                  t("board.messages.rocketmq.replay.mode"),
                  t(
                    result.ordered
                      ? "board.messages.rocketmq.replay.ordered"
                      : "board.messages.rocketmq.replay.concurrent",
                  ),
                ],
                [
                  t("board.messages.rocketmq.replay.autoCommit"),
                  t(result.autoCommit ? "common.yes" : "common.no"),
                ],
              ]}
            />
          </Panel>
        )}

        <FieldDescription className="text-xs">
          {t("board.messages.rocketmq.replay.note")}
        </FieldDescription>

        <DialogFooter className="items-center">
          {error != null && (
            <span className="mr-auto max-w-64 text-xs text-(--c-err)">{error}</span>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            disabled={group === "" || client === "" || running}
            onClick={() => void run()}
          >
            {running && <Spinner />}
            {t("board.messages.rocketmq.replay.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
