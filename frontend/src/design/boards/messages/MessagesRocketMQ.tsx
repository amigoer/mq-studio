import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
  DetailPanel,
  DetailPanelBody,
  JsonBlock,
  JsonText,
  KV,
  ProtoBadge,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
  Timeline,
  useToast,
} from "@/components";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRecentPicks } from "@/hooks/useRecentPicks";
import { copyText } from "@/api/platform";
import * as messageApi from "@/api/message";
import * as topicApi from "@/api/topic";
import { topicName } from "@/mq/rocketmq/destinations";
import type { MessageItem } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

const MODES = [
  { value: "key", label: "board.common.byKey" },
  { value: "msgid", label: "board.messages.rocketmq.byMsgId" },
  { value: "tag", label: "board.messages.rocketmq.byTag" },
] as const;
type Mode = (typeof MODES)[number]["value"];

/** The windows the range picker offers, in hours. */
const RANGES = [1, 6, 24, 72] as const;

/** `2026-08-30 10:24:07` -> `10:24:07`; the date is the same for every row. */
function storedAt(item: MessageItem): string {
  const match = /\d{2}:\d{2}:\d{2}(\.\d+)?/.exec(item.storeTime);
  return match?.[0] ?? (item.storeTime || "—");
}

/** The body as it should read, and whether it is JSON worth colouring. */
function prettyBody(body: string): { text: string; json: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(body), null, 2), json: true };
  } catch {
    // Not every payload is JSON, and a body that is not gets shown as it is.
    return { text: body, json: false };
  }
}

/**
 * Board 3d — RocketMQ message search.
 *
 * A query is a deliberate act, not something a page does on arriving: a topic
 * with millions of messages should not be scanned because a tab was opened. So
 * the table is empty until 查询 is pressed, and nothing auto-refreshes.
 */
export function MessagesRocketMQ() {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("key");
  const [topic, setTopic] = useState("");
  const [term, setTerm] = useState("");
  const [hours, setHours] = useState<number>(6);
  const [selected, setSelected] = useState<string | null>(null);

  const [results, setResults] = useState<MessageItem[] | null>(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { recent, record } = useRecentPicks("topic");
  const topicList = useBrokerData(
    useCallback((id: number) => topicApi.getTopics(id), []),
  );
  const topics = (topicList.data ?? []).map(topicName);
  // Recently used first, then the rest: the handful one service is being
  // debugged against is almost always the answer.
  const offered = [...recent.filter((name) => topics.includes(name)), ...topics.filter((name) => !recent.includes(name))];

  const runQuery = async () => {
    if (topic === "" || !online) return;
    setQuerying(true);
    setError(null);
    setSelected(null);
    try {
      const endTimeMs = Date.now();
      const found = await messageApi.queryMessagesByCondition(connID, topic, {
        messageId: mode === "msgid" ? term : undefined,
        messageKey: mode === "key" ? term : undefined,
        messageTag: mode === "tag" ? term : undefined,
        // A message id names one message, so the window is irrelevant to it.
        startTimeMs: mode === "msgid" ? 0 : endTimeMs - hours * 3_600_000,
        endTimeMs: mode === "msgid" ? 0 : endTimeMs,
      });
      setResults(found);
      record(topic);
    } catch (failure) {
      setError(formatErrorMessage(failure));
      setResults(null);
      toast.error(t("board.messages.rocketmq.queryFailed"), {
        description: formatErrorMessage(failure),
      });
    } finally {
      setQuerying(false);
    }
  };

  const current = results?.find((item) => item.messageId === selected);

  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} />
      <Toolbar>
        <Combobox
          value={topic}
          onValueChange={setTopic}
          options={offered.slice(0, 200)}
          placeholder={t("board.messages.rocketmq.pickTopic")}
          prefix="Topic："
          searchPlaceholder={t("board.common.searchTopic")}
          emptyText={t("board.common.noMatch")}
          className="max-w-64"
        />
        <Segmented options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Input
          className="mono3 w-[180px] flex-none"
          value={term}
          placeholder={t(`board.messages.rocketmq.placeholder.${mode}`)}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runQuery();
          }}
        />
        {mode !== "msgid" && (
          <SelectField
            value={String(hours)}
            onValueChange={(next) => setHours(Number(next))}
            options={RANGES.map((option) => ({
              value: String(option),
              label: t("board.messages.rocketmq.lastHours", { hours: option }),
            }))}
          />
        )}
        <Button disabled={topic === "" || querying || !online} onClick={() => void runQuery()}>
          {querying && <Spinner />}
          {t("board.common.query")}
        </Button>
      </Toolbar>

      {!online ? (
        <BoardState state={{ online, loading: false, error: null, refresh: async () => {} }} />
      ) : error != null ? (
        <Notice title={t("board.messages.rocketmq.queryFailed")} tone="var(--c-err)">
          {error}
        </Notice>
      ) : results == null ? (
        <Notice title={t("board.messages.rocketmq.readyTitle")}>
          {t("board.messages.rocketmq.readyHint")}
        </Notice>
      ) : results.length === 0 ? (
        <Notice title={t("board.messages.rocketmq.noResults")}>
          {t("board.messages.rocketmq.noResultsHint")}
        </Notice>
      ) : (
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>MsgId</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead className="text-right">{t("board.common.queue")}</TableHead>
                  <TableHead>{t("board.messages.rocketmq.storedAt")}</TableHead>
                  <TableHead>{t("board.common.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((item) => (
                  <TableRow
                    key={item.messageId}
                    selected={selected === item.messageId}
                    onClick={() => setSelected(item.messageId)}
                  >
                    <TableCell className="mono3 max-w-70 truncate text-xs">
                      {item.messageId}
                    </TableCell>
                    <TableCell className="mono3 max-w-50 truncate text-xs">
                      {item.keys || "—"}
                    </TableCell>
                    <TableCell>{item.tags || "—"}</TableCell>
                    <TableCell className="mono3 text-right">q{item.queueId}</TableCell>
                    <TableCell className="mono3 text-xs">{storedAt(item)}</TableCell>
                    <TableCell>
                      <Status tone={item.status === "dlq" ? "err" : item.status === "retry" ? "warn" : "ok"}>
                        {t(`board.messages.rocketmq.status.${item.status || "normal"}`)}
                      </Status>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListPane>

          {current != null && (
            <MessageSheet
              key={current.messageId}
              message={current}
              topic={topic}
              onClose={() => setSelected(null)}
            />
          )}
        </ListArea>
      )}
    </Page>
  );
}

function MessageSheet({
  message,
  topic,
  onClose,
}: {
  message: MessageItem;
  topic: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  // The trace is one request per message, so it is fetched when a message is
  // opened rather than for every row in the result.
  const track = useBrokerData(
    useCallback(
      (id: number) => messageApi.getMessageTrack(id, topic, message.messageId),
      [message.messageId, topic],
    ),
    { refreshMs: null },
  );

  const copy = (value: string) => {
    void copyText(value)
      .then(() => toast.success(t("board.common.copied")))
      .catch(() => {});
  };

  const body = prettyBody(message.body);

  return (
    <DetailPanel width={440} onDismiss={onClose}>
      <div className="flex items-center gap-2 border-b bg-background px-4 py-3">
        <b className="text-base font-semibold">{t("board.common.messageDetail")}</b>
        <ProtoBadge protocol="rocketmq" label="RMQ" />
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => copy(message.body)}>
          {t("board.common.export")}
        </Button>
      </div>

      <DetailPanelBody>
        <KV
          rows={[
            [
              "MsgId",
              <span className="mono3 inline-flex items-center gap-1.5 text-xs">
                {message.messageId}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t("board.common.copy")}
                  onClick={() => copy(message.messageId)}
                >
                  <Copy />
                </Button>
              </span>,
            ],
            [
              "Key / Tag",
              <span className="mono3 text-xs">
                {message.keys || "—"} · {message.tags || "—"}
              </span>,
            ],
            [
              t("board.messages.rocketmq.location"),
              <span className="mono3 text-xs">
                q{message.queueId} / offset {message.queueOffset.toLocaleString()}
              </span>,
            ],
            ["Born", <span className="mono3 text-xs">{message.bornHost || "—"}</span>],
            [
              t("board.messages.rocketmq.storedAt"),
              <span className="mono3 text-xs">{message.storeTime || "—"}</span>,
            ],
            [
              t("board.messages.rocketmq.retry"),
              <span className="mono3 text-xs">{message.retryTimes}</span>,
            ],
          ]}
        />

        <div>
          <SectionLabel className="mb-1.5">{t("board.messages.rocketmq.body")}</SectionLabel>
          <JsonBlock>
            {body.json ? <JsonText>{body.text}</JsonText> : body.text}
          </JsonBlock>
        </div>

        <div className="min-h-0 flex-1">
          <SectionLabel className="mb-2">{t("board.common.trace")}</SectionLabel>
          {isBlocked(track) ? (
            <BoardState state={track} />
          ) : (track.data ?? []).length === 0 ? (
            <Notice title={t("board.messages.rocketmq.noTrace")} />
          ) : (
            <Timeline
              steps={(track.data ?? []).map((entry) => ({
                title: entry.consumerGroup,
                meta: entry.consumeStatus,
                color:
                  entry.trackType === "CONSUMED"
                    ? undefined
                    : entry.trackType === "UNKNOWN"
                      ? "var(--c-muted-2)"
                      : "var(--c-warn)",
                extra:
                  entry.exceptionDesc === "" ? undefined : (
                    <span className="text-(--c-err-text)">{entry.exceptionDesc}</span>
                  ),
              }))}
            />
          )}
        </div>
      </DetailPanelBody>
    </DetailPanel>
  );
}
