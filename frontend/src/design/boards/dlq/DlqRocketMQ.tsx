import { useCallback, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { BulkBar, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Combobox,
  Panel,
  Segmented,
  useToast,
} from "@/components";
import { Checkbox } from "@/components/ui/checkbox";
import { BoardState, Notice } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useSettings } from "@/hooks/useSettings";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRecentPicks } from "@/hooks/useRecentPicks";
import * as consumerApi from "@/api/consumer";
import * as messageApi from "@/api/message";
import { groupName } from "@/mq/rocketmq/subscriptions";
import type { MessageItem } from "@/api/models";
import { formatMessageTime } from "@/lib/time";
import { formatErrorMessage } from "@/lib/utils";

/*
 * The canvas printed a count on each of these. Nothing reports one: the
 * dead-letter figure the group carries is the whole queue, the retry queue has
 * no figure at all, and what a query returns is a page rather than a total. The
 * fetched count goes in the subtitle instead, where it can say what it is.
 */
const VIEWS = [
  { value: "retry", label: "board.dlq.rocketmq.retryQueue" },
  { value: "dlq", label: "board.dlq.rocketmq.dlqQueue" },
] as const;
type View = (typeof VIEWS)[number]["value"];

const MONO11 = { fontSize: "11px" } as const;
const DIM11 = { fontSize: "11px", color: "var(--c-mono-dim)" } as const;
const R = { textAlign: "right" } as const;

/**
 * The business topic a retry or dead-letter copy came from.
 *
 * The message's own topic is `%DLQ%group`; the original travels in the
 * properties RocketMQ sets when it moves a message aside.
 */
function originTopic(item: MessageItem): string {
  return (
    item.properties?.["RETRY_TOPIC"] ??
    item.properties?.["REAL_TOPIC"] ??
    item.topic
  );
}

/**
 * Board 9b — RocketMQ %RETRY% / %DLQ%.
 *
 * The canvas's "最后失败原因" column is gone. A dead-letter copy carries the
 * original message and its redelivery count, not the exception that stopped
 * it; that lives in the consumer's own logs. Showing a reason here would mean
 * inventing one.
 *
 * Redelivery republishes the original content to the business topic, so it
 * writes a fresh MsgId and leaves the dead-letter copy in place. The confirm
 * step spells that out because it is the surprising half.
 */
export function DlqRocketMQ() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const { settings } = useSettings();

  const [view, setView] = useState<View>("dlq");
  const [group, setGroup] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [resending, setResending] = useState(false);

  const [rows, setRows] = useState<MessageItem[] | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recent, record } = useRecentPicks("group");
  const groupList = useBrokerData(
    useCallback((id: number) => consumerApi.getConsumerGroups(id), []),
  );
  const groups = (groupList.data ?? []).map(groupName);
  const offered = [
    ...recent.filter((name) => groups.includes(name)),
    ...groups.filter((name) => !recent.includes(name)),
  ];

  const runQuery = async (nextView: View = view, nextGroup: string = group) => {
    if (nextGroup === "" || !online) return;
    setQuerying(true);
    setError(null);
    setChecked([]);
    try {
      const found =
        nextView === "dlq"
          ? await messageApi.queryDLQMessages(connID, nextGroup)
          : await messageApi.queryRetryMessages(connID, nextGroup);
      setRows(found);
      record(nextGroup);
    } catch (failure) {
      setError(formatErrorMessage(failure));
      setRows(null);
    } finally {
      setQuerying(false);
    }
  };

  const resend = async () => {
    const targets = (rows ?? []).filter((row) => checked.includes(row.messageId));
    setResending(true);
    let sent = 0;
    const failures: string[] = [];
    for (const target of targets) {
      try {
        await messageApi.resendMessage(connID, group, "", target.topic, target.messageId);
        sent += 1;
      } catch (failure) {
        failures.push(formatErrorMessage(failure));
      }
    }
    setResending(false);
    setConfirming(false);
    if (sent > 0) toast.success(t("board.dlq.rocketmq.resent", { count: sent }));
    if (failures.length > 0) {
      toast.error(t("board.dlq.rocketmq.resendFailed", { count: failures.length }), {
        description: failures[0],
      });
    }
    await runQuery();
  };

  const list = rows ?? [];
  const allChecked = list.length > 0 && checked.length === list.length;
  const toggle = (id: string) =>
    setChecked((previous) =>
      previous.includes(id) ? previous.filter((one) => one !== id) : [...previous, id],
    );

  return (
    <Page>
      <PageHeader
        title={t("board.common.dlqRetry")}
        subtitle={
          rows == null
            ? t("board.dlq.rocketmq.liveSubtitle")
            : t("board.dlq.rocketmq.fetched", { count: rows.length })
        }
      />
      <Toolbar>
        <Combobox
          value={group}
          onValueChange={(name) => {
            setGroup(name);
            void runQuery(view, name);
          }}
          options={offered}
          moreText={(hidden) => t("board.common.moreOptions", { count: hidden })}
          placeholder={t("board.dlq.rocketmq.pickGroup")}
          searchPlaceholder={t("board.common.searchGroups")}
          emptyText={t("board.common.noMatch")}
          className="max-w-72"
        />
        <Segmented
          options={VIEWS.map((o) => ({ ...o, label: t(o.label) }))}
          value={view}
          onChange={(next: View) => {
            setView(next);
            void runQuery(next);
          }}
        />
        <span className="flex-1" />
        <Button disabled={group === "" || querying || !online} onClick={() => void runQuery()}>
          {querying && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
          {t("board.common.query")}
        </Button>
      </Toolbar>

      {!online ? (
        <BoardState state={{ online, loading: false, error: null, refresh: async () => {} }} />
      ) : error != null ? (
        <Notice title={t("board.dlq.rocketmq.queryFailed")} tone="var(--c-err)">
          {error}
        </Notice>
      ) : rows == null ? (
        <Notice title={t("board.dlq.rocketmq.pickGroupTitle")}>
          {t("board.dlq.rocketmq.pickGroupHint")}
        </Notice>
      ) : list.length === 0 ? (
        <Notice title={t(view === "dlq" ? "board.dlq.rocketmq.noDlq" : "board.dlq.rocketmq.noRetry")} />
      ) : (
        <>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead style={{ width: "28px" }}>
                    <Checkbox
                      checked={allChecked}
                      aria-label={t("board.common.selectAll")}
                      onCheckedChange={() =>
                        setChecked(allChecked ? [] : list.map((row) => row.messageId))
                      }
                    />
                  </TableHead>
                  <TableHead>MsgId</TableHead>
                  <TableHead>{t("board.dlq.rocketmq.originTopic")}</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead style={R}>{t("board.common.retry")}</TableHead>
                  <TableHead>{t("board.dlq.rocketmq.deadAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const on = checked.includes(row.messageId);
                  const dim = on ? undefined : "var(--c-mono-dim)";
                  return (
                    <TableRow key={row.messageId} selected={on}>
                      <TableCell>
                        <Checkbox checked={on} aria-label={row.messageId} onCheckedChange={() => toggle(row.messageId)} />
                      </TableCell>
                      <TableCell className="mono3" style={{ ...MONO11, color: dim }}>
                        {row.messageId}
                      </TableCell>
                      <TableCell className="mono3" style={DIM11}>
                        {originTopic(row)}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...MONO11, color: dim }}>
                        {row.keys || "—"}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...R, color: dim }}>
                        {row.retryTimes}
                      </TableCell>
                      <TableCell className="mono3" style={{ ...MONO11, color: dim }}>
                        {formatMessageTime(
                          row.storeTime,
                          settings.timezone,
                          settings.timestampFormat,
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>

          <BulkBar hint={t("board.dlq.rocketmq.hint")}>
            <span>{t("board.common.selectedN", { n: checked.length })}</span>
            <Button
              disabled={checked.length === 0 || resending}
              onClick={() => setConfirming(true)}
            >
              {t("board.dlq.rocketmq.resend")}
            </Button>
          </BulkBar>
        </>
      )}

      {confirming && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--c-scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 6,
          }}
          onClick={() => setConfirming(false)}
        >
          <Panel
            role="alertdialog"
            aria-label={t("board.dlq.rocketmq.confirmLabel")}
            style={{ width: "420px", boxShadow: "0 18px 50px rgba(0,0,0,.22)", overflow: "hidden" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ padding: "16px 20px 4px" }}>
              <b style={{ fontSize: "13.5px" }}>
                {t("board.dlq.rocketmq.confirmTitle", { n: checked.length })}
              </b>
            </div>
            <div
              style={{
                padding: "8px 20px 16px",
                fontSize: "12px",
                color: "var(--c-fg-2)",
                lineHeight: 1.7,
              }}
            >
              <Trans
                i18nKey="board.dlq.rocketmq.confirmBody"
                components={{
                  b: <b />,
                  topic: <span className="mono3" style={MONO11} />,
                  group: <span className="mono3" style={MONO11} />,
                }}
                values={{
                  topic: originTopic(
                    list.find((row) => checked.includes(row.messageId)) ?? list[0]!,
                  ),
                  group,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                padding: "12px 20px",
                borderTop: "1px solid var(--c-border)",
                background: "var(--c-panel)",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--c-muted)", alignSelf: "center" }}>
                {t("board.dlq.rocketmq.risky")}
              </span>
              <span className="flex-1" />
              <Button variant="outline" onClick={() => setConfirming(false)}>{t("board.common.cancel")}</Button>
              <Button disabled={resending} onClick={() => void resend()}>
                {resending && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
                {t("board.dlq.rocketmq.confirmAction")}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </Page>
  );
}
