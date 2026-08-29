import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, RefreshCw } from "lucide-react";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
import {
  Btn,
  Field,
  JsonBlock,
  KV,
  Menu,
  MenuItem,
  ProtoBadge,
  SectionLabel,
  Seg,
  SelectField,
  Sheet,
  SheetBody,
  Status,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Timeline,
  TR,
  useToast,
} from "@/design/ui";
import { BoardState, Notice, isBlocked } from "@/design/boards/BoardState";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRecentPicks } from "@/hooks/useRecentPicks";
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

const MONO11 = { fontSize: "11px" } as const;
const R = { textAlign: "right" } as const;

/** `2026-08-30 10:24:07` -> `10:24:07`; the date is the same for every row. */
function storedAt(item: MessageItem): string {
  const match = /\d{2}:\d{2}:\d{2}(\.\d+)?/.exec(item.storeTime);
  return match?.[0] ?? (item.storeTime || "—");
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // Not every payload is JSON, and a body that is not gets shown as it is.
    return body;
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
  const [topicOpen, setTopicOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
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
        <span style={{ position: "relative" }}>
          <SelectField
            value={topic === "" ? t("board.messages.rocketmq.pickTopic") : `Topic：${topic}`}
            onClick={() => setTopicOpen((open) => !open)}
          />
          <Menu open={topicOpen} onClose={() => setTopicOpen(false)}>
            {offered.slice(0, 200).map((name) => (
              <MenuItem
                key={name}
                onSelect={() => {
                  setTopic(name);
                  setTopicOpen(false);
                }}
              >
                {name}
              </MenuItem>
            ))}
          </Menu>
        </span>
        <Seg options={MODES.map((o) => ({ ...o, label: t(o.label) }))} value={mode} onChange={setMode} />
        <Field
          className="mono3"
          style={{ flex: "0 0 180px" }}
          value={term}
          placeholder={t(`board.messages.rocketmq.placeholder.${mode}`)}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runQuery();
          }}
        />
        {mode !== "msgid" && (
          <span style={{ position: "relative" }}>
            <SelectField
              value={t("board.messages.rocketmq.lastHours", { hours })}
              onClick={() => setRangeOpen((open) => !open)}
            />
            <Menu open={rangeOpen} onClose={() => setRangeOpen(false)}>
              {RANGES.map((option) => (
                <MenuItem
                  key={option}
                  onSelect={() => {
                    setHours(option);
                    setRangeOpen(false);
                  }}
                >
                  {t("board.messages.rocketmq.lastHours", { hours: option })}
                </MenuItem>
              ))}
            </Menu>
          </span>
        )}
        <Btn variant="primary" disabled={topic === "" || querying || !online} onClick={() => void runQuery()}>
          {querying && <RefreshCw size={12} className="mqs-turning" aria-hidden />}
          {t("board.common.query")}
        </Btn>
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
            <Table className="inset">
              <THead>
                <TR>
                  <TH>MsgId</TH>
                  <TH>Key</TH>
                  <TH>Tag</TH>
                  <TH style={R}>{t("board.common.queue")}</TH>
                  <TH>{t("board.messages.rocketmq.storedAt")}</TH>
                  <TH>{t("board.common.status")}</TH>
                </TR>
              </THead>
              <TBody>
                {results.map((item) => (
                  <TR
                    key={item.messageId}
                    selected={selected === item.messageId}
                    onClick={() => setSelected(item.messageId)}
                  >
                    <TD className="mono3" style={MONO11}>
                      {item.messageId}
                    </TD>
                    <TD className="mono3" style={MONO11}>
                      {item.keys || "—"}
                    </TD>
                    <TD>{item.tags || "—"}</TD>
                    <TD className="mono3" style={R}>
                      q{item.queueId}
                    </TD>
                    <TD className="mono3" style={MONO11}>
                      {storedAt(item)}
                    </TD>
                    <TD>
                      <Status tone={item.status === "dlq" ? "err" : item.status === "retry" ? "warn" : "ok"}>
                        {t(`board.messages.rocketmq.status.${item.status || "normal"}`)}
                      </Status>
                    </TD>
                  </TR>
                ))}
              </TBody>
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
    void navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(t("board.common.copied")))
      .catch(() => {});
  };

  return (
    <Sheet width={440} onDismiss={onClose}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          borderBottom: "1px solid var(--c-border)",
          background: "var(--c-bg)",
        }}
      >
        <b style={{ fontSize: "13px" }}>{t("board.common.messageDetail")}</b>
        <ProtoBadge protocol="rocketmq" label="RMQ" />
        <span style={{ flex: 1 }} />
        <Btn onClick={() => copy(message.body)}>{t("board.common.export")}</Btn>
      </div>

      <SheetBody>
        <KV
          rows={[
            [
              "MsgId",
              <span
                className="mono3"
                style={{ ...MONO11, display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                {message.messageId}
                <button
                  type="button"
                  className="mqs-linkbtn"
                  aria-label={t("board.common.copy")}
                  onClick={() => copy(message.messageId)}
                  style={{ display: "flex", textDecoration: "none" }}
                >
                  <Copy size={12} aria-hidden />
                </button>
              </span>,
            ],
            [
              "Key / Tag",
              <span className="mono3" style={MONO11}>
                {message.keys || "—"} · {message.tags || "—"}
              </span>,
            ],
            [
              t("board.messages.rocketmq.location"),
              <span className="mono3" style={MONO11}>
                q{message.queueId} / offset {message.queueOffset.toLocaleString()}
              </span>,
            ],
            ["Born", <span className="mono3" style={MONO11}>{message.bornHost || "—"}</span>],
            [
              t("board.messages.rocketmq.storedAt"),
              <span className="mono3" style={MONO11}>{message.storeTime || "—"}</span>,
            ],
            [
              t("board.messages.rocketmq.retry"),
              <span className="mono3" style={MONO11}>{message.retryTimes}</span>,
            ],
          ]}
        />

        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>{t("board.messages.rocketmq.body")}</SectionLabel>
          <JsonBlock>{prettyBody(message.body)}</JsonBlock>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <SectionLabel style={{ marginBottom: "8px" }}>{t("board.common.trace")}</SectionLabel>
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
                    <span style={{ color: "var(--c-err-text)" }}>{entry.exceptionDesc}</span>
                  ),
              }))}
            />
          )}
        </div>
      </SheetBody>
    </Sheet>
  );
}
