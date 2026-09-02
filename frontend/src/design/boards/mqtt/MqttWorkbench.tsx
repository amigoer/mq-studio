import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CirclePause, CirclePlay, Trash2 } from "lucide-react";
import { Page, PageBody, PageHeader } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KV, Panel, PanelHeader, SectionLabel, SelectField, Status, WarnBanner } from "@/components";
import { useMqttStream } from "@/hooks/mqtt/useMqttStream";
import type { LiveMessage } from "@/api/models";
import { formatCount } from "@/lib/format";

const MONO11 = { fontSize: "11px" } as const;

/** The QoS a subscription asks for. */
const QOS_OPTIONS = [
  { value: "0", label: "QoS 0" },
  { value: "1", label: "QoS 1" },
  { value: "2", label: "QoS 2" },
];

function attribute(message: LiveMessage, key: string): string {
  return message.attributes?.[key] ?? "";
}

/** The 5.0 properties a message carried, as rows for the detail column. */
function properties(message: LiveMessage): { key: string; value: string }[] {
  const attributes = message.attributes ?? {};
  return Object.entries(attributes)
    .filter(([key]) => key !== "qos" && key !== "retained")
    .map(([key, value]) => ({ key, value: value ?? "" }));
}

/**
 * Board 4b — the MQTT subscribe workbench.
 *
 * There is no durable search and no consumer group here, so the page is a
 * filter box, a live stream and a detail column rather than the list-and-sheet
 * every other protocol uses. What it shows exists only while it is subscribed:
 * MQTT keeps no history, so closing this page loses what it saw, and that is
 * the protocol rather than a shortcut.
 *
 * Three things the page has to report that a message list normally would not.
 * A dropped count, because the buffer behind it is bounded and a stream that
 * is quietly losing looks exactly like a quiet one. Whether the session is
 * still live, because a dropped connection also looks like silence. And the
 * retain flag per message, because a retained value can be hours old and
 * arrives looking like something that just happened.
 */
export function MqttWorkbench() {
  const { t } = useTranslation();
  const stream = useMqttStream();
  const [pattern, setPattern] = useState("#");

  // A stream started before this panel mounted keeps running, so the box shows
  // what is actually being watched rather than the default it opens with.
  const adopted = stream.filters[0];
  useEffect(() => {
    if (adopted != null && adopted !== "") setPattern(adopted);
  }, [adopted]);
  const [qos, setQos] = useState("0");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const messages = needle === ""
      ? stream.messages
      : stream.messages.filter(
          (message) =>
            message.destination.toLowerCase().includes(needle) ||
            message.body.toLowerCase().includes(needle),
        );
    // Newest first: a live view is read from the top.
    return [...messages].reverse();
  }, [stream.messages, search]);

  const detail = useMemo(
    () => shown.find((message) => message.seq === selected) ?? shown[0] ?? null,
    [shown, selected],
  );

  return (
    <Page>
      <PageHeader
        title={t("shell.nav.mqtt.subscribe")}
        subtitle={
          stream.running
            ? t("board.mqtt.subscribedTo", { pattern, count: stream.received })
            : t("board.mqtt.notSubscribed")
        }
        actions={
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Input
              className="mono3"
              style={{ ...MONO11, width: "200px" }}
              value={pattern}
              placeholder="sensors/#"
              onChange={(event) => setPattern(event.target.value)}
              disabled={stream.running}
            />
            <SelectField
              value={qos}
              options={QOS_OPTIONS}
              onValueChange={setQos}
              disabled={stream.running}
            />
            {stream.running ? (
              <Button variant="outline" onClick={() => stream.stop()}>
                <CirclePause size={14} aria-hidden />
                {t("board.mqtt.stop")}
              </Button>
            ) : (
              <Button
                disabled={pattern.trim() === ""}
                onClick={() =>
                  stream.start({
                    filters: [{ pattern: pattern.trim(), qos: Number.parseInt(qos, 10) }],
                    buffer: 0,
                  })
                }
              >
                <CirclePlay size={14} aria-hidden />
                {t("board.mqtt.subscribe")}
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        {stream.error != null && <WarnBanner>{stream.error}</WarnBanner>}
        {/*
          A stream whose session dropped keeps its buffer and stops filling it.
          Saying so is the difference between a quiet broker and one this app
          has stopped listening to, which look identical on screen.
        */}
        {stream.running && !stream.live && (
          <WarnBanner>{t("board.mqtt.sessionDown")}</WarnBanner>
        )}
        {/*
          The buffer is bounded, so a stream faster than this page loses
          messages. A silent loss would read as a gap in the traffic.
        */}
        {stream.dropped > 0 && (
          <WarnBanner>
            {t("board.mqtt.dropped", { count: stream.dropped })}
          </WarnBanner>
        )}

        <div style={{ display: "flex", gap: "12px", minHeight: 0, flex: 1 }}>
          <Panel style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <PanelHeader
              title={t("board.mqtt.live")}
              action={
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <Input
                    style={{ width: "180px" }}
                    value={search}
                    placeholder={t("board.mqtt.filter")}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {t("board.mqtt.held", { count: stream.messages.length })}
                  </span>
                  <Button variant="ghost" onClick={() => stream.clear()}>
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
              }
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("board.common.time")}</TableHead>
                  <TableHead>{t("board.mqtt.topic")}</TableHead>
                  <TableHead>QoS</TableHead>
                  <TableHead>{t("board.mqtt.payload")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((message) => (
                  <TableRow
                    key={message.seq}
                    onClick={() => setSelected(message.seq)}
                    aria-selected={detail?.seq === message.seq}
                  >
                    <TableCell className="mono3" style={MONO11}>
                      {message.receivedAt}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {message.destination}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {attribute(message, "qos")}
                      {/* A retained value can be hours old and arrives looking
                          like something that just happened. */}
                      {attribute(message, "retained") === "true" && (
                        <Status tone="warn">{t("board.mqtt.retained")}</Status>
                      )}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {message.body}
                      {message.truncated && <span> {t("board.mqtt.truncated")}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <Panel style={{ width: "300px", flex: "none", display: "flex", flexDirection: "column" }}>
            <PanelHeader title={t("board.mqtt.detail")} />
            {detail == null ? (
              <div style={{ padding: "14px", fontSize: "12px", color: "var(--c-muted)" }}>
                {stream.running ? t("board.mqtt.waiting") : t("board.mqtt.startToSee")}
              </div>
            ) : (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <KV
                  rows={[
                    [t("board.mqtt.topic"), detail.destination],
                    // Which of the subscription's filters matched, because a
                    // wildcard cannot be read back from the topic alone.
                    [t("board.mqtt.matched"), detail.filter],
                    [t("board.common.time"), detail.receivedAt],
                  ]}
                />
                <SectionLabel>{t("board.mqtt.payload")}</SectionLabel>
                <pre className="mono3" style={{ ...MONO11, whiteSpace: "pre-wrap", margin: 0 }}>
                  {detail.body}
                </pre>
                {properties(detail).length > 0 && (
                  <>
                    <SectionLabel>{t("board.mqtt.userProps")}</SectionLabel>
                    <KV
                      rows={properties(detail).map(
                        (entry) => [entry.key, entry.value] as const,
                      )}
                    />
                  </>
                )}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.mqtt.noHistory", { count: formatCount(stream.received) })}
        </div>
      </PageBody>
    </Page>
  );
}
