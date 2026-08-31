import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
  DetailPanelHeader,
  JsonBlock,
  KV,
  SectionLabel,
  Segmented,
  SelectField,
  Status,
  WarnBanner,
} from "@/components";
import { useKafkaTopics } from "@/hooks/kafka/useKafkaTopics";
import { useKafkaRead, useKafkaTail } from "@/hooks/kafka/useKafkaMessages";
import { formatCount } from "@/lib/format";
import { isI18nKey } from "@/lib/utils";
import { isInternal } from "@/mq/kafka/destinations";
import {
  formatValue,
  hasKey,
  headerCount,
  headersOf,
  isTombstone,
  keyOf,
  shapeOf,
  type ReadMode,
} from "@/mq/kafka/messages";
import type { MessageItem } from "@/api/models";

const R = { textAlign: "right" } as const;
const MONO11 = { fontSize: "11px" } as const;

/** How often a running tail asks for what has arrived. */
const TAIL_INTERVAL_MS = 1500;

type Panel = "query" | "tail";

/**
 * Board 13a — Kafka messages.
 *
 * Two things the canvas implied that are not true, and the board says so.
 *
 * Searching by key is a scan. Kafka indexes nothing but the offset, so finding
 * a key means reading the log until it turns up; the mode is offered because
 * it is genuinely useful and labelled because a search that finds nothing on a
 * busy topic has usually just run out of budget.
 *
 * A record carries no content type. Kafka moves bytes and says nothing about
 * what is in them, so how a value is drawn is this app's guess and is named as
 * one rather than shown as the record's own declaration.
 */
export function MessagesKafka() {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel>("query");
  const [topic, setTopic] = useState("");
  const [partition, setPartition] = useState("");
  const [mode, setMode] = useState<ReadMode>("latest");
  const [startOffset, setStartOffset] = useState("");
  const [startTime, setStartTime] = useState("");
  const [key, setKey] = useState("");
  const [limit, setLimit] = useState("100");
  const [selected, setSelected] = useState<string | null>(null);

  const topics = useKafkaTopics();
  const read = useKafkaRead();
  const tail = useKafkaTail(panel === "tail" ? topic : "");

  const choices = useMemo(
    () =>
      (topics.data ?? [])
        .filter((entry) => !isInternal(entry))
        .map((entry) => ({ value: entry.ref.name }))
        .sort((left, right) => left.value.localeCompare(right.value)),
    [topics.data],
  );

  /*
   * The tail's timer lives here, not in the hook: it has to stop when the page
   * changes panel or unmounts, and an interval owned by the hook would keep
   * polling a topic nobody is looking at.
   */
  const running = panel === "tail" && topic !== "";
  const step = useRef(tail.step);
  step.current = tail.step;
  useEffect(() => {
    if (!running) return;
    void step.current();
    const timer = setInterval(() => void step.current(), TAIL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, topic]);

  const rows = panel === "query" ? read.records : tail.records;
  const current = rows.find((record) => record.messageId === selected) ?? null;

  const runQuery = () =>
    void read.run({
      topic,
      partition: partition === "" ? null : Number.parseInt(partition, 10),
      mode,
      startOffset,
      startTime: startTime === "" ? 0 : Date.parse(startTime),
      key,
      limit: Number.parseInt(limit, 10) || 100,
    });

  const canQuery =
    topic !== "" &&
    (mode !== "offset" || startOffset.trim() !== "") &&
    (mode !== "time" || startTime !== "") &&
    (mode !== "key" || key.trim() !== "");

  return (
    <Page>
      <PageHeader title={t("board.common.messageQuery")} subtitle={t("board.messages.kafka.subtitle")} />
      <Toolbar>
        <Segmented<Panel>
          options={[
            { value: "query", label: t("board.messages.kafka.read") },
            { value: "tail", label: t("board.messages.kafka.tail") },
          ]}
          value={panel}
          onChange={(next) => {
            setPanel(next);
            setSelected(null);
            tail.reset();
          }}
        />
        <Combobox
          value={topic}
          options={choices}
          placeholder={t("board.messages.kafka.pickTopic")}
          onValueChange={(next: string) => {
            setTopic(next);
            setSelected(null);
            tail.reset();
          }}
        />
        {panel === "query" && (
          <>
            <Input
              className="mono3 w-[110px] flex-none"
              placeholder={t("board.messages.kafka.allPartitions")}
              value={partition}
              onChange={(event) => setPartition(event.target.value)}
            />
            <SelectField<ReadMode>
              value={mode}
              options={[
                { value: "latest", label: t("board.common.latestN") },
                { value: "offset", label: t("board.messages.kafka.byOffset") },
                { value: "time", label: t("board.common.byTime") },
                { value: "key", label: t("board.messages.kafka.byKey") },
              ]}
              onValueChange={setMode}
            />
            {mode === "offset" && (
              <Input
                className="mono3 w-[120px] flex-none"
                placeholder="offset"
                value={startOffset}
                onChange={(event) => setStartOffset(event.target.value)}
              />
            )}
            {mode === "time" && (
              <Input
                type="datetime-local"
                className="w-[190px] flex-none"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            )}
            {mode === "key" && (
              <Input
                className="mono3 w-[150px] flex-none"
                placeholder="key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            )}
            <Input
              className="mono3 w-[80px] flex-none"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
            <Button disabled={!canQuery || read.loading} onClick={runQuery}>
              {read.loading && <Spinner />}
              {t("board.common.query")}
            </Button>
          </>
        )}
        <span className="flex-1" />
        {panel === "tail" && topic !== "" && (
          <Status tone="ok">{t("board.messages.kafka.following")}</Status>
        )}
      </Toolbar>

      {panel === "query" && mode === "key" && (
        <WarnBanner>{t("board.messages.kafka.keyScanNote")}</WarnBanner>
      )}
      {panel === "tail" && tail.dropped > 0 && (
        <WarnBanner>
          {t("board.messages.kafka.dropped", { count: formatCount(tail.dropped) })}
        </WarnBanner>
      )}
      {(read.error ?? tail.error) != null && (
        <WarnBanner>
          {isI18nKey(read.error ?? tail.error ?? "")
            ? t(read.error ?? tail.error ?? "")
            : (read.error ?? tail.error)}
        </WarnBanner>
      )}

      <ListArea>
        <ListPane>
          <Table inset>
            <TableHeader>
              <TableRow>
                <TableHead style={R}>{t("board.common.partition")}</TableHead>
                <TableHead style={R}>Offset</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>{t("board.messages.kafka.valueSummary")}</TableHead>
                <TableHead style={R}>Headers</TableHead>
                <TableHead>{t("board.common.timestamp")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((record) => (
                <TableRow
                  key={record.messageId}
                  selected={selected === record.messageId}
                  onClick={() => setSelected(record.messageId)}
                >
                  <TableCell className="mono3" style={R}>{record.queueId}</TableCell>
                  <TableCell className="mono3" style={R}>{record.queueOffset}</TableCell>
                  <TableCell className="mono3" style={MONO11}>
                    {/* A record with no key at all is not one with an empty
                        key: Kafka spreads the first and pins the second. */}
                    {hasKey(record) ? (
                      keyOf(record)
                    ) : (
                      <span style={{ color: "var(--c-muted)" }}>
                        {t("board.messages.kafka.noKey")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="mono3" style={{ ...MONO11, color: "var(--c-mono-dim)" }}>
                    <ValueSummary record={record} />
                  </TableCell>
                  <TableCell className="mono3" style={R}>{headerCount(record)}</TableCell>
                  <TableCell className="mono3" style={MONO11}>{record.storeTime}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} style={{ padding: "18px", color: "var(--c-muted)" }}>
                    {panel === "tail"
                      ? t("board.messages.kafka.tailWaiting")
                      : read.ran
                        ? t("board.messages.kafka.noneFound")
                        : t("board.messages.kafka.pickAndQuery")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ListPane>

        {current != null && (
          <DetailPanel width={430} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={`offset ${current.queueOffset}`}
              badge={<Status tone="off" style={{ fontSize: "10px" }}>p{current.queueId}</Status>}
              tabs={[{ id: "record", label: t("board.common.message") }]}
              activeTab="record"
              onTabChange={() => {}}
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody style={{ gap: "10px" }}>
              <KV
                rows={[
                  [t("board.messages.kafka.id"), current.messageId],
                  ["Key", hasKey(current) ? keyOf(current) : t("board.messages.kafka.noKey")],
                  [t("board.common.timestamp"), current.storeTime],
                  [t("board.messages.kafka.shape"), t(`board.messages.kafka.shape_${shapeOf(current.body)}`)],
                ]}
              />
              {isTombstone(current) && (
                <WarnBanner>{t("board.messages.kafka.tombstone")}</WarnBanner>
              )}
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Value</SectionLabel>
                <JsonBlock>{formatValue(current.body)}</JsonBlock>
              </div>
              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>Headers</SectionLabel>
                {headerCount(current) === 0 ? (
                  <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {t("board.messages.kafka.noHeaders")}
                  </span>
                ) : (
                  <KV rows={Object.entries(headersOf(current))} />
                )}
              </div>
            </DetailPanelBody>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/** The first line of a value, or a note that it is not text at all. */
function ValueSummary({ record }: { record: MessageItem }) {
  const { t } = useTranslation();
  const shape = shapeOf(record.body);
  if (shape === "empty") {
    return <span style={{ color: "var(--c-muted)" }}>{t("board.messages.kafka.empty")}</span>;
  }
  if (shape === "binary") {
    return <span style={{ color: "var(--c-muted)" }}>{t("board.messages.kafka.binary")}</span>;
  }
  return <>{record.body.slice(0, 60)}</>;
}
