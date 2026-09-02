import { useMemo, useState } from "react";
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
  DetailPanel,
  DetailPanelBody,
  DetailPanelHeader,
  JsonBlock,
  KV,
  SectionLabel,
  SelectField,
  Status,
} from "@/components";
import { useNatsBrowse } from "@/hooks/nats/useNatsMessages";
import { useNatsStreams } from "@/hooks/nats/useNatsStreams";
import { streamName } from "@/mq/nats/destinations";
import {
  bodyOf,
  deduplicationId,
  headers,
  isEmpty,
  sequenceOf,
  storedAt,
  subjectOf,
} from "@/mq/nats/messages";
import { formatCount } from "@/lib/format";
import type { MessageItem } from "@bindings/model/models";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/**
 * Browsing a stream's messages.
 *
 * A search rather than a list that loads itself, because a browse is a
 * question somebody asks: which stream, which subjects, from where. A page
 * that fetched on mount would read the head of whatever stream happened to be
 * first, and re-read it every refresh interval for nobody.
 *
 * The subject filter is the one the server can act on - JetStream narrows by
 * subject and by nothing else - so the header filter says plainly that it is
 * applied after the messages arrive. What it saves is the reader's attention,
 * not the network, and a control that implied otherwise would be a
 * performance promise this family cannot keep.
 */
export function MessagesNats() {
  const { t } = useTranslation();
  const streams = useNatsStreams();
  const browse = useNatsBrowse();

  const streamNames = useMemo(
    () => (streams.data ?? []).map((stream) => streamName(stream)),
    [streams.data],
  );

  const [stream, setStream] = useState("");
  const [subject, setSubject] = useState("");
  const [startSeq, setStartSeq] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const chosen = stream !== "" ? stream : (streamNames[0] ?? "");
  const panel = useMemo(
    () => browse.messages.find((message) => sequenceOf(message) === selected) ?? null,
    [browse.messages, selected],
  );

  const search = () =>
    void browse.run({
      stream: chosen,
      subject,
      startSeq,
      headerName,
      headerValue,
      limit: 100,
    });

  return (
    <Page>
      <PageHeader
        title={t("board.messages.nats.title")}
        subtitle={t("board.messages.nats.subtitle")}
      />
      <Toolbar>
        <div style={{ width: "180px", flex: "none" }}>
          <SelectField<string>
            value={chosen}
            options={streamNames.map((name) => ({ value: name, label: name }))}
            placeholder={t("board.messages.nats.pickStream")}
            onValueChange={setStream}
          />
        </div>
        <Input
          className="w-[180px] flex-none mono3"
          placeholder={t("board.messages.nats.subject")}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
        <Input
          className="w-[130px] flex-none mono3"
          placeholder={t("board.messages.nats.fromSequence")}
          value={startSeq}
          onChange={(event) => setStartSeq(event.target.value)}
        />
        <Input
          className="w-[130px] flex-none mono3"
          placeholder={t("board.messages.nats.headerName")}
          value={headerName}
          onChange={(event) => setHeaderName(event.target.value)}
        />
        <Input
          className="w-[130px] flex-none mono3"
          placeholder={t("board.messages.nats.headerValue")}
          value={headerValue}
          onChange={(event) => setHeaderValue(event.target.value)}
        />
        <Button disabled={chosen === "" || browse.loading} onClick={search}>
          {browse.loading && <Spinner className="size-3.5" />}
          {t("board.messages.nats.search")}
        </Button>
        <span className="flex-1" />
        <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
          {t("board.messages.nats.found", { count: browse.messages.length })}
        </span>
      </Toolbar>

      {headerName.trim() !== "" && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: "11px",
            color: "var(--c-muted)",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          {/* Said out loud rather than implied: JetStream filters by subject
              and by nothing else, so this one runs on messages that have
              already been fetched. */}
          {t("board.messages.nats.headerFilterNote")}
        </div>
      )}

      <ListArea>
        <ListPane>
          {browse.error != null ? (
            <div style={{ padding: "24px", fontSize: "11.5px", color: "var(--c-err)" }}>
              {browse.error}
            </div>
          ) : browse.messages.length === 0 ? (
            <div
              style={{
                padding: "24px",
                fontSize: "11.5px",
                color: "var(--c-muted)",
                textAlign: "center",
              }}
            >
              {browse.searched
                ? t("board.messages.nats.noMatches")
                : t("board.messages.nats.startHere")}
            </div>
          ) : (
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead style={RIGHT}>{t("board.messages.nats.sequence")}</TableHead>
                  <TableHead>{t("board.messages.nats.subject")}</TableHead>
                  <TableHead>{t("board.messages.nats.stored")}</TableHead>
                  <TableHead>{t("board.messages.nats.body")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {browse.messages.map((message) => (
                  <TableRow
                    key={sequenceOf(message)}
                    selected={selected === sequenceOf(message)}
                    onClick={() => setSelected(sequenceOf(message))}
                  >
                    <TableCell className="mono3" style={RIGHT}>
                      {formatCount(sequenceOf(message))}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {subjectOf(message)}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      {storedAt(message)}
                    </TableCell>
                    <TableCell className="mono3" style={MONO11}>
                      <Preview message={message} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ListPane>

        {panel != null && (
          <DetailPanel width={420} onDismiss={() => setSelected(null)}>
            <DetailPanelHeader
              title={`#${sequenceOf(panel)}`}
              badge={
                <Status tone="off" style={{ fontSize: "10px" }}>
                  {subjectOf(panel)}
                </Status>
              }
              onClose={() => setSelected(null)}
            />
            <DetailPanelBody>
              <KV
                rows={[
                  [
                    t("board.messages.nats.sequence"),
                    <span className="mono3" style={MONO11}>
                      {sequenceOf(panel)}
                    </span>,
                  ],
                  [
                    t("board.messages.nats.subject"),
                    <span className="mono3" style={MONO11}>
                      {subjectOf(panel)}
                    </span>,
                  ],
                  [
                    t("board.messages.nats.stored"),
                    <span className="mono3" style={MONO11}>
                      {storedAt(panel)}
                    </span>,
                  ],
                  [
                    t("board.messages.nats.dedupId"),
                    <span className="mono3" style={MONO11}>
                      {/* Shown because it is usually the application's own id,
                          which is what somebody is looking for - but a lookup
                          takes the sequence, and the hint says so. */}
                      {deduplicationId(panel) ?? (
                        <span style={{ color: "var(--c-muted-2)" }}>—</span>
                      )}
                    </span>,
                  ],
                ]}
              />

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>
                  {t("board.messages.nats.headers")}
                </SectionLabel>
                {headers(panel).length === 0 ? (
                  <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {t("board.messages.nats.noHeaders")}
                  </div>
                ) : (
                  <KV
                    rows={headers(panel).map(([name, value]) => [
                      name,
                      <span className="mono3" style={MONO11}>
                        {value}
                      </span>,
                    ])}
                  />
                )}
              </div>

              <div>
                <SectionLabel style={{ marginBottom: "6px" }}>
                  {t("board.messages.nats.body")}
                </SectionLabel>
                {isEmpty(panel) ? (
                  <div style={{ fontSize: "11px", color: "var(--c-muted)" }}>
                    {/* Ordinary rather than a fault: a subject alone is a
                        signal, and request/reply uses empty messages
                        routinely. An empty panel would read as a failed load. */}
                    {t("board.messages.nats.emptyBody")}
                  </div>
                ) : (
                  <JsonBlock>{bodyOf(panel)}</JsonBlock>
                )}
              </div>
            </DetailPanelBody>
          </DetailPanel>
        )}
      </ListArea>
    </Page>
  );
}

/** One line of the body, with an empty one named rather than left blank. */
function Preview({ message }: { message: MessageItem }) {
  const { t } = useTranslation();
  if (isEmpty(message)) {
    return (
      <span style={{ color: "var(--c-muted-2)" }}>{t("board.messages.nats.emptyShort")}</span>
    );
  }
  const body = bodyOf(message);
  const line = body.split("\n", 1)[0] ?? "";
  return <>{line.length > 80 ? `${line.slice(0, 80)}…` : line}</>;
}
