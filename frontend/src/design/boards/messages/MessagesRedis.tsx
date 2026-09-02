import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListArea, ListPane, Page, PageHeader, Toolbar } from "@/design/shell";
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
import {
  DetailPanel,
  DetailPanelBody,
  DetailPanelFooter,
  DetailPanelHeader,
  KV,
  SectionLabel,
  SelectField,
  Status,
  toast,
  useConfirm,
} from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRedisEntries } from "@/hooks/redis/useRedisEntries";
import { useRedisStreams } from "@/hooks/redis/useRedisStreams";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import { formatErrorMessage } from "@/lib/utils";
import { copyText } from "@/api/platform";
import {
  addedAt,
  asJson,
  entryId,
  fieldCount,
  fields,
  summary,
} from "@/mq/redis/messages";
import { streamKey } from "@/mq/redis/destinations";

const MONO11 = { fontSize: "11px" } as const;
const RIGHT = { textAlign: "right" } as const;

/**
 * Board 13d — Redis Stream entries.
 *
 * An entry is a set of field/value pairs rather than a payload with metadata
 * attached, so the list shows how many fields and a summary of them, and the
 * panel shows every one. There is no body to render on its own: Redis has no
 * convention naming one field the payload, and picking one would be inventing
 * a schema the server does not have.
 *
 * The time window is the one place the canonical query fits Redis exactly. An
 * entry id is milliseconds plus a sequence, so "from" and "to" are the id
 * range the server takes - no scan and no client-side date matching.
 */
export function MessagesRedis() {
  const { t } = useTranslation();
  const streams = useRedisStreams();
  const entries = useRedisEntries();
  const { id: connID } = useConnectionScope();
  const confirm = useConfirm();

  const [stream, setStream] = useState("");
  const [contains, setContains] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const streamKeys = useMemo(
    () => (streams.data ?? []).map((candidate) => streamKey(candidate)).sort(),
    [streams.data],
  );

  /* Land on a stream as soon as one is known, so the page has something to
     read rather than an empty picker. */
  useEffect(() => {
    const first = streamKeys[0];
    if (stream === "" && first != null) setStream(first);
  }, [stream, streamKeys]);

  const run = useCallback(() => {
    if (stream === "") return;
    void entries.query({ stream, contains: contains.trim() || undefined });
  }, [contains, entries, stream]);

  const detail = useMemo(
    () => entries.items.find((item) => entryId(item) === selected) ?? null,
    [entries.items, selected],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: t("board.messages.redis.deleteTitle", { id }),
        description: t("board.messages.redis.deleteHint"),
        confirmLabel: t("board.common.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        const { removed } = await redisApi.deleteEntries(connID, stream, [id]);
        if (removed === 0) {
          /* XDEL succeeds on an id that has already gone and removes nothing.
             Reporting that as a deletion would have the row vanish from the
             page while the entry it named was removed by someone else. */
          toast.error(t("board.messages.redis.deleteMissing"));
        } else {
          toast.success(t("board.messages.redis.deleted", { id }));
        }
        setSelected(null);
        run();
      } catch (deleteError) {
        toast.error(t("board.messages.redis.deleteFailed"), {
          description: formatErrorMessage(deleteError),
        });
      }
    },
    [confirm, connID, run, stream, t],
  );

  return (
    <Page>
      <PageHeader
        title={t("board.common.messageQuery")}
        subtitle={t("board.messages.redis.subtitle")}
      />
      <Toolbar>
        <SelectField
          value={stream}
          prefix="Stream："
          options={streamKeys.map((key) => ({ value: key }))}
          onValueChange={(next: string) => {
            setStream(next);
            setSelected(null);
          }}
        />
        <Input
          className="mono3 w-[220px] flex-none"
          style={MONO11}
          placeholder={t("board.messages.redis.contains")}
          value={contains}
          onChange={(event) => setContains(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") run();
          }}
        />
        <Button disabled={stream === "" || entries.running} onClick={run}>
          {t("board.common.query")}
        </Button>
        <span className="flex-1" />
        {entries.lastCount != null && (
          <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>
            {/* What the read returned, not what the stream holds. A window is
                a page and the filter is applied over a bounded scan, so this
                is deliberately not called a total. */}
            {t("board.messages.redis.read", { count: entries.lastCount })}
          </span>
        )}
      </Toolbar>

      <BoardState
        state={entries.state}
        empty={
          entries.items.length === 0 ? (
            <ListArea>
              <ListPane>
                <div
                  style={{
                    padding: "24px",
                    fontSize: "11.5px",
                    color: "var(--c-muted)",
                    textAlign: "center",
                  }}
                >
                  {entries.lastCount === null
                    ? t("board.messages.redis.pickAStream")
                    : t("board.messages.redis.nothingRead")}
                </div>
              </ListPane>
            </ListArea>
          ) : undefined
        }
      >
        <ListArea>
          <ListPane>
            <Table inset>
              <TableHeader>
                <TableRow>
                  <TableHead>Entry ID</TableHead>
                  <TableHead style={RIGHT}>{t("board.messages.redis.fieldCount")}</TableHead>
                  <TableHead>{t("board.messages.redis.fieldSummary")}</TableHead>
                  <TableHead>{t("board.common.time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.items.map((item) => {
                  const id = entryId(item);
                  return (
                    <TableRow key={id} selected={selected === id} onClick={() => setSelected(id)}>
                      <TableCell className="mono3" style={MONO11}>
                        {id}
                      </TableCell>
                      <TableCell className="mono3" style={RIGHT}>
                        {fieldCount(item)}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {summary(item)}
                      </TableCell>
                      <TableCell className="mono3" style={MONO11}>
                        {addedAt(item)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ListPane>

          {detail != null && (
            <DetailPanel width={420} onDismiss={() => setSelected(null)}>
              <DetailPanelHeader
                title={entryId(detail)}
                badge={
                  <Status tone="off" style={{ fontSize: "10px" }}>
                    entry
                  </Status>
                }
                onClose={() => setSelected(null)}
              />
              <DetailPanelBody>
                <div>
                  <SectionLabel style={{ marginBottom: "6px" }}>
                    {t("board.messages.redis.fields")}
                  </SectionLabel>
                  <KV
                    rows={fields(detail).map(({ name, value }) => [
                      name,
                      <span className="mono3" style={MONO11}>
                        {value}
                      </span>,
                    ])}
                  />
                </div>
                <KV
                  rows={[
                    [
                      t("board.common.time"),
                      <span className="mono3" style={MONO11}>
                        {addedAt(detail)}
                      </span>,
                    ],
                  ]}
                />
              </DetailPanelBody>
              <DetailPanelFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    void copyText(asJson(detail));
                    toast.success(t("board.messages.redis.copied"));
                  }}
                >
                  {t("board.common.copy")}
                </Button>
                <span className="flex-1" />
                <Button variant="destructive" onClick={() => void remove(entryId(detail))}>
                  XDEL
                </Button>
              </DetailPanelFooter>
            </DetailPanel>
          )}
        </ListArea>
      </BoardState>
    </Page>
  );
}
