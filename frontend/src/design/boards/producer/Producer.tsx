import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, RefreshCw, Send } from "lucide-react";
import { Page, PageHeader } from "@/design/shell";
import {
  Btn,
  Card,
  Field,
  Menu,
  MenuItem,
  SectionLabel,
  Seg,
  SelectField,
  Status,
  TextArea,
  useToast,
} from "@/design/ui";
import type { ProtocolId } from "@/design/data/protocols";
import { PROTOCOL_PANELS } from "./ProducerPanels";
import { useBrokerData } from "@/hooks/useBrokerData";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { useRecentPicks } from "@/hooks/useRecentPicks";
import * as messageApi from "@/api/message";
import * as topicApi from "@/api/topic";
import { topicName } from "@/mq/rocketmq/destinations";
import { formatErrorMessage } from "@/lib/utils";

const BODY_FORMATS = [
  { value: "json", label: "board.term.json" },
  { value: "text", label: "board.producer.text" },
] as const;
type BodyFormat = (typeof BODY_FORMATS)[number]["value"];

/** RocketMQ's fixed delay ladder. Level 0 sends immediately. */
const DELAY_LEVELS = [
  "1s", "5s", "10s", "30s", "1m", "2m", "3m", "4m", "5m",
  "6m", "7m", "8m", "9m", "10m", "20m", "30m", "1h", "2h",
] as const;

/** One send is one round trip, so a burst is bounded. */
const MAX_COUNT = 50;

interface SendOutcome {
  ok: boolean;
  detail: string;
  topic: string;
  at: string;
}

/**
 * Board 3e — the send console.
 *
 * Four of the options the canvas drew are gone, because the send path behind
 * them does not exist: async and one-way sending (the bridge sends
 * synchronously and returns the id), ordered-by-key sending (no queue
 * selector), custom properties (the send input carries none), and hex bodies
 * (nothing decodes one). Delay level and a bounded repeat count are real and
 * stay.
 *
 * Only RocketMQ can send. The other five keep their drawn panel and say so
 * rather than offering a button that cannot work.
 */
export function Producer({ protocol }: { protocol: ProtocolId }) {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const toast = useToast();
  const Panel = PROTOCOL_PANELS[protocol];
  const wired = protocol === "rocketmq";

  const [format, setFormat] = useState<BodyFormat>("json");
  const [topic, setTopic] = useState("");
  const [tags, setTags] = useState("");
  const [keys, setKeys] = useState("");
  const [body, setBody] = useState('{\n  "orderId": "ORD-TEST-001"\n}');
  const [delayLevel, setDelayLevel] = useState(0);
  const [count, setCount] = useState(1);
  const [topicOpen, setTopicOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [recentSends, setRecentSends] = useState<SendOutcome[]>([]);

  const { recent, record } = useRecentPicks("topic");
  const topicList = useBrokerData(
    useCallback((id: number) => topicApi.getTopics(id), []),
    { enabled: wired },
  );
  const topics = (topicList.data ?? []).map(topicName);
  const offered = [
    ...recent.filter((name) => topics.includes(name)),
    ...topics.filter((name) => !recent.includes(name)),
  ];

  const formatBody = () => {
    try {
      setBody(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      toast.error(t("board.producer.notJson"));
    }
  };

  const send = async () => {
    if (topic === "" || !online || !wired) return;
    setSending(true);
    const stamp = new Date().toLocaleTimeString();
    let sent = 0;
    let lastId = "";
    let failure: string | null = null;
    for (let index = 0; index < Math.min(MAX_COUNT, Math.max(1, count)); index++) {
      try {
        lastId = await messageApi.sendMessage(connID, topic, tags, keys, body, delayLevel);
        sent += 1;
      } catch (error) {
        failure = formatErrorMessage(error);
        break;
      }
    }
    setSending(false);
    setRecentSends((previous) =>
      [
        {
          ok: failure == null,
          detail: failure ?? lastId,
          topic,
          at: stamp,
        },
        ...previous,
      ].slice(0, 8),
    );
    if (failure == null) {
      record(topic);
      toast.success(t("board.producer.sentN", { count: sent }), { description: lastId });
    } else {
      toast.error(t("board.producer.failed"), { description: failure });
    }
  };

  const blocked = !wired
    ? t("board.producer.notWired")
    : !online
      ? t("board.state.offline")
      : topic === ""
        ? t("board.producer.pickTopicFirst")
        : null;

  return (
    <Page>
      <PageHeader
        title={t("board.common.sendMessage")}
        subtitle={t("board.producer.subtitle")}
        actions={
          <>
            {blocked != null && (
              <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>{blocked}</span>
            )}
            <Btn variant="primary" disabled={blocked != null || sending} onClick={() => void send()}>
              {sending ? (
                <RefreshCw size={13} className="mqs-turning" aria-hidden />
              ) : (
                <Send size={13} aria-hidden />
              )}
              {t("board.producer.send")}
            </Btn>
          </>
        }
      />

      <div style={{ flex: 1, display: "flex", gap: "16px", padding: "16px 20px", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          <Card style={{ padding: "13px 16px", display: "flex", gap: "10px", alignItems: "center" }}>
            <SectionLabel style={{ flex: "none" }}>{t("board.common.target")}</SectionLabel>
            {wired ? (
              <>
                <span style={{ position: "relative", flex: 1 }}>
                  <SelectField
                    style={{ width: "100%" }}
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
                <Field
                  style={{ flex: "0 0 130px" }}
                  placeholder="Tag"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
                <Field
                  className="mono3"
                  style={{ flex: "0 0 170px" }}
                  placeholder="Keys"
                  value={keys}
                  onChange={(event) => setKeys(event.target.value)}
                />
              </>
            ) : (
              <span style={{ fontSize: "11.5px", color: "var(--c-muted)" }}>
                {t("board.producer.notWired")}
              </span>
            )}
          </Card>

          <Card
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 14px",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <Seg
                options={BODY_FORMATS.map((o) => ({ ...o, label: t(o.label) }))}
                value={format}
                onChange={setFormat}
              />
              <span style={{ flex: 1 }} />
              {format === "json" && (
                <button type="button" className="mqs-linkbtn" onClick={formatBody}>
                  {t("board.common.format")}
                </button>
              )}
            </div>

            <TextArea
              className="mono3 mqs-scroll"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                minHeight: 0,
                border: "none",
                borderRadius: 0,
                resize: "none",
                padding: "12px 16px",
                fontSize: "11.5px",
                lineHeight: 1.8,
                color: "var(--c-fg-2)",
              }}
            />
          </Card>
        </div>

        <div
          style={{
            width: "300px",
            flex: "none",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            minHeight: 0,
          }}
        >
          <Card style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <SectionLabel>{t("board.producer.options")}</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
              <span>{t("board.producer.delayLevel")}</span>
              <span style={{ position: "relative" }}>
                <SelectField
                  style={{ width: "120px" }}
                  value={delayLevel === 0 ? t("board.producer.noDelay") : DELAY_LEVELS[delayLevel - 1]!}
                  onClick={() => setDelayOpen((open) => !open)}
                />
                <Menu open={delayOpen} onClose={() => setDelayOpen(false)}>
                  <MenuItem
                    onSelect={() => {
                      setDelayLevel(0);
                      setDelayOpen(false);
                    }}
                  >
                    {t("board.producer.noDelay")}
                  </MenuItem>
                  {DELAY_LEVELS.map((label, index) => (
                    <MenuItem
                      key={label}
                      onSelect={() => {
                        setDelayLevel(index + 1);
                        setDelayOpen(false);
                      }}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </Menu>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
              <span>{t("board.producer.count")}</span>
              <Field
                style={{ width: "64px", textAlign: "right" }}
                value={String(count)}
                onChange={(event) =>
                  setCount(Math.max(1, Math.min(MAX_COUNT, Number(event.target.value) || 1)))
                }
              />
            </div>
          </Card>

          <Card style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <Panel />
          </Card>

          <Card style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <SectionLabel style={{ padding: "11px 16px 8px" }}>{t("board.producer.recent")}</SectionLabel>
            {recentSends.length === 0 ? (
              <div style={{ padding: "0 16px 12px", fontSize: "11px", color: "var(--c-muted)" }}>
                {t("board.producer.noSends")}
              </div>
            ) : (
              recentSends.map((outcome, index) => (
                <RecentSend
                  key={`${outcome.at}-${index}`}
                  tone={outcome.ok ? "ok" : "err"}
                  label={t(outcome.ok ? "board.producer.ok" : "board.producer.failed")}
                  detail={`${outcome.topic} · ${outcome.at}`}
                  title={outcome.detail}
                />
              ))
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function RecentSend({
  tone,
  label,
  detail,
  title,
}: {
  tone: "ok" | "err";
  label: string;
  detail: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      style={{
        padding: "0 16px 6px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "11.5px",
      }}
    >
      <Status tone={tone} style={{ fontSize: "10px" }}>
        {tone === "ok" ? <Check size={11} aria-hidden /> : null}
        {label}
      </Status>
      <span
        className="mono3"
        style={{
          color: "var(--c-mono-dim)",
          fontSize: "10.5px",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </span>
    </div>
  );
}
