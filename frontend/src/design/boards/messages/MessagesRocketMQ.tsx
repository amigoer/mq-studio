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
  DetailPanelFooter,
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
import { useSettings } from "@/hooks/useSettings";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRecentPicks } from "@/hooks/useRecentPicks";
import { copyText } from "@/api/platform";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import * as consumerApi from "@/api/consumer";
import * as messageApi from "@/api/message";
import * as topicApi from "@/api/topic";
import { topicName } from "@/mq/rocketmq/destinations";
import { groupName } from "@/mq/rocketmq/subscriptions";
import { ReplayDialog } from "./ReplayDialog";
import { useMessageTail } from "@/hooks/useMessageTail";
import { Switch } from "@/components/ui/switch";
import type { BoardProps } from "@/design/registry";
import type { MessageItem } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";
import { formatMessageTime } from "@/lib/time";
import { BODY_MODES, renderBody, type BodyMode } from "./messageBody";

const MODES = [
  { value: "key", label: "board.common.byKey" },
  { value: "msgid", label: "board.messages.rocketmq.byMsgId" },
  { value: "tag", label: "board.messages.rocketmq.byTag" },
] as const;
type Mode = (typeof MODES)[number]["value"];

/** The windows the range picker offers, in hours. A custom range is 0. */
const RANGES = [1, 6, 24, 72] as const;
const CUSTOM_RANGE = 0;

/** How much of a topic one query reads. 0 defers to the configured page size. */
const LIMITS = [0, 32, 64, 128, 256] as const;

/** `<input type="datetime-local">` wants local wall-clock, to the minute. */
function toLocalInput(ms: number): string {
  const at = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return at.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Board 3d — RocketMQ message search.
 *
 * A query is a deliberate act, not something a page does on arriving: a topic
 * with millions of messages should not be scanned because a tab was opened. So
 * the table is empty until 查询 is pressed, and nothing auto-refreshes.
 */
export function MessagesRocketMQ({ nav }: BoardProps = {}) {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const { settings } = useSettings();

  const [mode, setMode] = useState<Mode>("key");
  const [topic, setTopic] = useState(nav?.focus?.topic ?? "");
  const [term, setTerm] = useState("");
  const [hours, setHours] = useState<number>(6);
  // Only read once the range is set to custom; the preset is what most
  // searches want, and two datetime fields on the toolbar by default are two
  // fields nobody fills in.
  const [begin, setBegin] = useState(() => toLocalInput(Date.now() - 6 * 3_600_000));
  const [end, setEnd] = useState(() => toLocalInput(Date.now()));
  const [limit, setLimit] = useState<number>(0);
  const [selected, setSelected] = useState<string | null>(null);

  const [results, setResults] = useState<MessageItem[] | null>(null);
  const tail = useMessageTail(topic);
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
      const now = Date.now();
      const custom = hours === CUSTOM_RANGE;
      const startTimeMs = custom ? fromLocalInput(begin) : now - hours * 3_600_000;
      const endTimeMs = custom ? fromLocalInput(end) : now;
      if (custom && (startTimeMs == null || endTimeMs == null)) {
        setQuerying(false);
        toast.error(t("board.messages.rocketmq.badRange"));
        return;
      }
      if (custom && startTimeMs != null && endTimeMs != null && startTimeMs > endTimeMs) {
        setQuerying(false);
        toast.error(t("board.messages.rocketmq.rangeReversed"));
        return;
      }
      const found = await messageApi.queryMessagesByCondition(connID, topic, {
        messageId: mode === "msgid" ? term : undefined,
        messageKey: mode === "key" ? term : undefined,
        messageTag: mode === "tag" ? term : undefined,
        // A message id names one message, so the window is irrelevant to it.
        startTimeMs: mode === "msgid" ? 0 : (startTimeMs ?? 0),
        endTimeMs: mode === "msgid" ? 0 : (endTimeMs ?? 0),
      }, limit);
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

  // One table serves both modes: a query fills it once, the tail keeps filling
  // it. Which rows it holds is the only difference between them.
  const rows = tail.running ? tail.messages : (results ?? []);
  const current = rows.find((item) => item.messageId === selected);

  const list = (
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
            {rows.map((item) => (
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
                <TableCell className="mono3 text-xs">
                  {formatMessageTime(
                    item.storeTime,
                    settings.timezone,
                    settings.timestampFormat,
                  )}
                </TableCell>
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
  );

  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} />
      <Toolbar>
        <Combobox
          value={topic}
          onValueChange={setTopic}
          options={offered}
          moreText={(hidden) => t("board.common.moreOptions", { count: hidden })}
          placeholder={t("board.messages.rocketmq.pickTopic")}
          prefix="Topic："
          searchPlaceholder={t("board.common.searchTopic")}
          emptyText={t("board.common.noMatch")}
          className="max-w-64"
        />
        {!tail.running && (
          <>
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
              <>
                <SelectField
                  value={String(hours)}
                  onValueChange={(next) => setHours(Number(next))}
                  options={[
                    ...RANGES.map((option) => ({
                      value: String(option),
                      label: t("board.messages.rocketmq.lastHours", { hours: option }),
                    })),
                    {
                      value: String(CUSTOM_RANGE),
                      label: t("board.messages.rocketmq.customRange"),
                    },
                  ]}
                />
                {hours === CUSTOM_RANGE && (
                  <>
                    <Input
                      type="datetime-local"
                      className="w-[190px] flex-none"
                      aria-label={t("board.messages.rocketmq.begin")}
                      value={begin}
                      onChange={(event) => setBegin(event.target.value)}
                    />
                    <Input
                      type="datetime-local"
                      className="w-[190px] flex-none"
                      aria-label={t("board.messages.rocketmq.end")}
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                    />
                  </>
                )}
              </>
            )}
            <SelectField
              value={String(limit)}
              onValueChange={(next) => setLimit(Number(next))}
              options={LIMITS.map((option) => ({
                value: String(option),
                label:
                  option === 0
                    ? t("board.messages.rocketmq.limitDefault", { count: settings.fetchLimit })
                    : t("board.messages.rocketmq.limitN", { count: option }),
              }))}
            />
            <Button disabled={topic === "" || querying || !online} onClick={() => void runQuery()}>
              {querying && <Spinner />}
              {t("board.common.query")}
            </Button>
          </>
        )}
        {tail.running && (
          <span className="text-xs text-(--c-muted)">
            {t("board.messages.rocketmq.tail.following", { count: tail.messages.length })}
            {tail.dropped > 0 && (
              <span className="ml-2 text-(--c-warn-text)">
                {t("board.messages.rocketmq.tail.dropped", { count: tail.dropped })}
              </span>
            )}
          </span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-(--c-mono-dim)">
          <Switch
            checked={tail.running}
            disabled={topic === "" || !online}
            onCheckedChange={(next) => {
              setSelected(null);
              if (next) tail.start();
              else tail.stop();
            }}
          />
          {t("board.messages.rocketmq.tail.live")}
        </label>
      </Toolbar>

      {!online ? (
        <BoardState state={{ online, loading: false, error: null, refresh: async () => {} }} />
      ) : tail.running ? (
        tail.error != null ? (
          <Notice title={t("board.messages.rocketmq.tail.failed")} tone="var(--c-err)">
            {tail.error}
          </Notice>
        ) : rows.length === 0 ? (
          <Notice title={t("board.messages.rocketmq.tail.waiting")}>
            {t("board.messages.rocketmq.tail.waitingHint")}
          </Notice>
        ) : (
          list
        )
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
        list
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
  const { settings } = useSettings();
  const [replaying, setReplaying] = useState(false);
  const [resending, setResending] = useState(false);
  const [bodyMode, setBodyMode] = useState<BodyMode>("auto");

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

  const body = renderBody(message.body, bodyMode, settings);
  const properties = Object.entries(message.properties ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const stamp = (value: string) =>
    formatMessageTime(value, settings.timezone, settings.timestampFormat);

  return (
    <DetailPanel width={440} onDismiss={onClose}>
      <div className="flex items-center gap-2 border-b bg-background px-4 py-3">
        <b className="text-base font-semibold">{t("board.common.messageDetail")}</b>
        <ProtoBadge protocol="rocketmq" label="RMQ" />
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setReplaying(true)}>
          {t("board.messages.rocketmq.replay.action")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => copy(message.body)}>
          {t("board.common.export")}
        </Button>
      </div>

      <ReplayDialog
        open={replaying}
        topic={topic}
        messageId={message.messageId}
        onClose={() => setReplaying(false)}
      />
      <ResendDialog
        open={resending}
        topic={topic}
        messageId={message.messageId}
        onClose={() => setResending(false)}
      />

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
            [
              t("board.common.status"),
              <Status
                tone={message.status === "dlq" ? "err" : message.status === "retry" ? "warn" : "ok"}
              >
                {t(`board.messages.rocketmq.status.${message.status || "normal"}`)}
              </Status>,
            ],
            ["Born", <span className="mono3 text-xs">{message.bornHost || "—"}</span>],
            ["Store", <span className="mono3 text-xs">{message.storeHost || "—"}</span>],
            [
              t("board.messages.rocketmq.storedAt"),
              <span className="mono3 text-xs">{stamp(message.storeTime)}</span>,
            ],
            [
              t("board.messages.rocketmq.retry"),
              <span className="mono3 text-xs">{message.retryTimes}</span>,
            ],
          ]}
        />

        <div>
          <SectionLabel
            className="mb-1.5"
            actionColor="inherit"
            action={
              <Segmented
                options={BODY_MODES.map((value) => ({
                  value,
                  label: t(`board.messages.rocketmq.bodyMode.${value}`),
                }))}
                value={bodyMode}
                onChange={setBodyMode}
              />
            }
          >
            {t("board.messages.rocketmq.body")}
            <span className="ml-1.5 font-normal tracking-normal normal-case text-(--c-muted)">
              {t(`board.messages.rocketmq.bodyKind.${body.kind}`)}
            </span>
          </SectionLabel>
          {body.truncated && (
            <div className="mb-1.5 text-[11px] text-(--c-warn-text)">
              {t("board.messages.rocketmq.bodyTruncated", {
                shown: Math.round(settings.maxPayloadRenderBytes / 1024),
                total: Math.round(body.originalBytes / 1024),
              })}
            </div>
          )}
          <JsonBlock>
            {body.json ? <JsonText>{body.text}</JsonText> : body.text}
          </JsonBlock>
        </div>

        <div>
          <SectionLabel className="mb-1.5">
            {t("board.messages.rocketmq.properties")}
          </SectionLabel>
          {properties.length === 0 ? (
            <Notice title={t("board.messages.rocketmq.noProperties")} />
          ) : (
            <KV
              className="grid-cols-[130px_1fr]"
              rows={properties.map(([key, value]) => [
                <span className="mono3 break-all">{key}</span>,
                <span className="mono3 break-all">{value || "—"}</span>,
              ])}
            />
          )}
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
      <DetailPanelFooter>
        <Button variant="outline" onClick={() => setResending(true)}>
          {t("board.messages.rocketmq.resend.action")}
        </Button>
      </DetailPanelFooter>
    </DetailPanel>
  );
}

/**
 * Publishes the message again on the retry path of one consumer group.
 *
 * Distinct from replay, which runs one client's handler and reports what it
 * returned: this hands the message back for whoever picks it up next.
 */
function ResendDialog({
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
  const toast = useToast();
  const { id: connID } = useConnectionScope();
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);

  const groups = useBrokerData(
    useCallback((id: number) => consumerApi.getConsumerGroups(id), []),
    { refreshMs: null, enabled: open },
  );
  const names = (groups.data ?? []).map(groupName);

  const submit = async () => {
    if (group === "") return;
    setSending(true);
    try {
      // No client id: the broker picks whichever member of the group is up,
      // which is what "put it back" means.
      await messageApi.resendMessage(connID, group, "", topic, messageId);
      toast.success(t("board.messages.rocketmq.resend.done", { group }));
      onClose();
    } catch (failure) {
      toast.error(t("board.messages.rocketmq.resend.failed"), {
        description: formatErrorMessage(failure),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("board.messages.rocketmq.resend.title")}</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("board.common.consumerGroup")}</FieldLabel>
            <SelectField
              value={group}
              onValueChange={setGroup}
              placeholder={t("board.messages.rocketmq.resend.pickGroup")}
              options={names.map((name) => ({ value: name, label: name }))}
            />
            <FieldDescription>
              {t("board.messages.rocketmq.resend.desc", { topic })}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("board.common.cancel")}</Button>
          <Button disabled={group === "" || sending} onClick={() => void submit()}>
            {sending && <Spinner />}
            {t("board.messages.rocketmq.resend.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
