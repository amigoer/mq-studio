import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Page, PageHeader, Toolbar } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, SectionLabel, Status } from "@/components";
import { useNatsStream } from "@/hooks/nats/useNatsStream";
import type { LiveMessage } from "@/api/models";

const MONO11 = { fontSize: "11px" } as const;

/**
 * Watching subjects as messages go past.
 *
 * Not the messages page with a filter on it, and the difference is the whole
 * reason this page exists. That one reads a stream: the messages are stored,
 * they can be paged back through, and asking again returns the same ones. This
 * one watches the wire. A core NATS message exists while it is in flight,
 * reaches whoever is subscribed at that instant, and is gone - so what is not
 * on this page was never anywhere to be found.
 *
 * Which makes two figures load-bearing rather than decorative. "Listening"
 * separates a connection that dropped from a subject nobody is publishing on,
 * and those are the same empty page. "Dropped" separates a stream that is
 * quietly losing messages from one that is quiet, and those are the same page
 * too.
 */
export function NatsWorkbench() {
  const { t } = useTranslation();
  const stream = useNatsStream();
  const [subjects, setSubjects] = useState("");
  const [queueGroup, setQueueGroup] = useState("");

  const patterns = useMemo(
    () =>
      subjects
        .split(/[\s,;]+/)
        .map((subject) => subject.trim())
        .filter((subject) => subject !== ""),
    [subjects],
  );

  const start = () =>
    stream.start({
      subjects: patterns,
      queueGroup: queueGroup.trim(),
      buffer: 0,
    } as Parameters<typeof stream.start>[0]);

  return (
    <Page>
      <PageHeader
        title={t("board.subscribe.nats.title")}
        subtitle={t("board.subscribe.nats.subtitle")}
        actions={
          stream.running ? (
            <Button variant="outline" onClick={stream.stop}>
              {t("board.subscribe.nats.stop")}
            </Button>
          ) : (
            <Button disabled={patterns.length === 0} onClick={start}>
              {t("board.subscribe.nats.start")}
            </Button>
          )
        }
      />
      <Toolbar>
        <Input
          className="w-[260px] flex-none mono3"
          placeholder={t("board.subscribe.nats.subjects")}
          value={subjects}
          disabled={stream.running}
          onChange={(event) => setSubjects(event.target.value)}
        />
        <Input
          className="w-[170px] flex-none mono3"
          placeholder={t("board.subscribe.nats.queueGroup")}
          value={queueGroup}
          disabled={stream.running}
          onChange={(event) => setQueueGroup(event.target.value)}
        />
        <span className="flex-1" />
        {stream.running && (
          <>
            {/* Listening or not, which is the difference between a dropped
                connection and a quiet subject. */}
            <Status tone={stream.live ? "ok" : "warn"} style={{ fontSize: "10px" }}>
              {stream.live
                ? t("board.subscribe.nats.listening")
                : t("board.subscribe.nats.notListening")}
            </Status>
            <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
              {t("board.subscribe.nats.received", { count: stream.received })}
            </span>
            {stream.dropped > 0 && (
              /* Shown only when it happened, and then prominently: a stream
                 quietly losing messages looks exactly like a quiet one. */
              <Status tone="warn" style={{ fontSize: "10px" }}>
                {t("board.subscribe.nats.dropped", { count: stream.dropped })}
              </Status>
            )}
          </>
        )}
        <Button variant="outline" disabled={stream.messages.length === 0} onClick={stream.clear}>
          {t("board.subscribe.nats.clear")}
        </Button>
      </Toolbar>

      {stream.running && stream.subjects.length > 0 && (
        <div
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid var(--c-border)",
            display: "flex",
            gap: "4px",
            flexWrap: "wrap",
          }}
        >
          {stream.subjects.map((subject) => (
            <Status key={subject} tone="off" style={{ fontSize: "10px" }}>
              {subject}
            </Status>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {stream.error != null ? (
          <Panel style={{ padding: "10px 12px", fontSize: "11.5px", color: "var(--c-err)" }}>
            {stream.error}
          </Panel>
        ) : stream.messages.length === 0 ? (
          <div
            style={{
              padding: "24px",
              fontSize: "11.5px",
              color: "var(--c-muted)",
              textAlign: "center",
            }}
          >
            {/* Three different empty pages, and they must not read the same. */}
            {!stream.running
              ? t("board.subscribe.nats.notStarted")
              : stream.live
                ? t("board.subscribe.nats.waiting")
                : t("board.subscribe.nats.disconnected")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {stream.messages.map((message) => (
              <Line key={message.seq} message={message} />
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}

/** One message as it arrived. */
function Line({ message }: { message: LiveMessage }) {
  const { t } = useTranslation();
  const replyTo = message.attributes?.replyTo;
  return (
    <Panel style={{ padding: "6px 10px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="mono3" style={{ ...MONO11, fontWeight: 600 }}>
          {message.destination}
        </span>
        <span style={{ fontSize: "10.5px", color: "var(--c-muted)" }}>{message.receivedAt}</span>
        {replyTo != null && replyTo !== "" && (
          /* A request rather than a plain publish, which changes what silence
             on this page means: nobody is answering, not nobody is sending. */
          <Status tone="off" style={{ fontSize: "10px" }}>
            {t("board.subscribe.nats.request")}
          </Status>
        )}
        {message.truncated && (
          <Status tone="warn" style={{ fontSize: "10px" }}>
            {t("board.subscribe.nats.truncated")}
          </Status>
        )}
      </div>
      <div
        className="mono3"
        style={{ ...MONO11, marginTop: "3px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        {message.body === "" ? (
          <span style={{ color: "var(--c-muted)" }}>
            {t("board.subscribe.nats.emptyBody")}
          </span>
        ) : (
          message.body
        )}
      </div>
      {message.filter !== message.destination && (
        <div style={{ fontSize: "10px", color: "var(--c-muted-2)", marginTop: "2px" }}>
          <SectionLabel style={{ display: "inline" }}>
            {t("board.subscribe.nats.matched", { filter: message.filter })}
          </SectionLabel>
        </div>
      )}
    </Panel>
  );
}
