import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Page, PageHeader, PageBody } from "@/design/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Panel, SectionLabel, SelectField, Status, toast } from "@/components";
import { BoardState } from "@/design/boards/BoardState";
import { useRedisStreams } from "@/hooks/redis/useRedisStreams";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as redisApi from "@/api/redis";
import { formatErrorMessage } from "@/lib/utils";
import { streamKey } from "@/mq/redis/destinations";
import { emptyEntryDraft, toDraft, validate, type EntryForm } from "./entryDraft";

const MONO11 = { fontSize: "11px" } as const;

/**
 * Board 15d — the Redis send console.
 *
 * The shared console collects a topic, tags, keys and a delay level, which is
 * RocketMQ's vocabulary and means nothing here. A stream entry is an ordered
 * list of named fields with an optional explicit id, so that is what this
 * collects.
 *
 * It will not create a stream. XADD would, and for a console that is the wrong
 * default: a mistyped key becoming a new stream holding one test message
 * leaves the operator looking at a list wondering where their entry went. The
 * stream is picked from what exists, and making one is its own gesture on its
 * own page.
 */
export function ProducerRedis() {
  const { t } = useTranslation();
  const streams = useRedisStreams();
  const { id: connID } = useConnectionScope();

  const [form, setForm] = useState<EntryForm>(emptyEntryDraft(""));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);

  const streamKeys = useMemo(
    () => (streams.data ?? []).map((candidate) => streamKey(candidate)).sort(),
    [streams.data],
  );

  useEffect(() => {
    const first = streamKeys[0];
    if (form.stream === "" && first != null) {
      setForm((current) => ({ ...current, stream: first }));
    }
  }, [form.stream, streamKeys]);

  const invalid = validate(form, t);

  const setField = (index: number, key: "name" | "value", next: string) =>
    setForm((current) => ({
      ...current,
      fields: current.fields.map((field, at) =>
        at === index ? { ...field, [key]: next } : field,
      ),
    }));

  const send = useCallback(async () => {
    if (invalid != null || busy) return;
    setBusy(true);
    try {
      const { ids } = await redisApi.addEntry(connID, toDraft(form));
      setSent(ids);
      toast.success(t("board.producer.redis.sent", { count: ids.length }));
      await streams.refresh();
    } catch (sendError) {
      toast.error(t("board.producer.redis.sendFailed"), {
        description: formatErrorMessage(sendError),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, connID, form, invalid, streams, t]);

  return (
    <Page>
      <PageHeader title="XADD" subtitle={t("board.producer.redis.subtitle")} />
      <BoardState
        state={streams}
        empty={
          streamKeys.length === 0 ? (
            <PageBody>
              <div
                style={{ padding: "24px", fontSize: "11.5px", color: "var(--c-muted)" }}
              >
                {t("board.producer.redis.noStreams")}
              </div>
            </PageBody>
          ) : undefined
        }
      >
        <PageBody>
          <Panel style={{ padding: "14px 16px", maxWidth: "640px" }}>
            <FieldGroup>
              <Field>
                <FieldLabel>Stream</FieldLabel>
                <SelectField
                  value={form.stream}
                  options={streamKeys.map((key) => ({ value: key }))}
                  onValueChange={(next: string) =>
                    setForm((current) => ({ ...current, stream: next }))
                  }
                />
                <FieldDescription>{t("board.producer.redis.streamHint")}</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>{t("board.producer.redis.fields")}</FieldLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {form.fields.map((field, index) => (
                    <div key={index} style={{ display: "flex", gap: "6px" }}>
                      <Input
                        className="mono3"
                        style={MONO11}
                        placeholder={t("board.producer.redis.fieldName")}
                        value={field.name}
                        onChange={(event) => setField(index, "name", event.target.value)}
                      />
                      <Input
                        className="mono3 flex-1"
                        style={MONO11}
                        placeholder={t("board.producer.redis.fieldValue")}
                        value={field.value}
                        onChange={(event) => setField(index, "value", event.target.value)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("board.common.delete")}
                        disabled={form.fields.length === 1}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            fields: current.fields.filter((_, at) => at !== index),
                          }))
                        }
                      >
                        <Trash2 size={13} aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="xs"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        fields: [...current.fields, { name: "", value: "" }],
                      }))
                    }
                  >
                    <Plus size={12} aria-hidden />
                    {t("board.producer.redis.addField")}
                  </Button>
                </div>
                {/* The order is the producer's and is kept on the way out.
                    Reading loses it - the client hands fields back as a map -
                    so the panel sorts, and this does not. */}
                <FieldDescription>{t("board.producer.redis.fieldsHint")}</FieldDescription>
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <Field>
                  <FieldLabel htmlFor="redis-entry-id">
                    {t("board.producer.redis.entryId")}
                  </FieldLabel>
                  <Input
                    id="redis-entry-id"
                    className="mono3"
                    style={MONO11}
                    placeholder="*"
                    value={form.id}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, id: event.target.value }))
                    }
                  />
                  <FieldDescription>{t("board.producer.redis.entryIdHint")}</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="redis-entry-count">
                    {t("board.producer.redis.count")}
                  </FieldLabel>
                  <Input
                    id="redis-entry-count"
                    className="mono3"
                    style={MONO11}
                    inputMode="numeric"
                    value={form.count}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, count: event.target.value }))
                    }
                  />
                  <FieldDescription>{t("board.producer.redis.countHint")}</FieldDescription>
                </Field>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Button disabled={invalid != null || busy} title={invalid ?? undefined} onClick={() => void send()}>
                  {busy && <Spinner className="size-3.5" />}
                  XADD
                </Button>
                {invalid != null && (
                  <span style={{ fontSize: "11px", color: "var(--c-muted)" }}>{invalid}</span>
                )}
              </div>
            </FieldGroup>
          </Panel>

          {sent.length > 0 && (
            <Panel style={{ padding: "12px 16px", marginTop: "10px", maxWidth: "640px" }}>
              <SectionLabel style={{ marginBottom: "6px" }}>
                {t("board.producer.redis.assigned")}
              </SectionLabel>
              {/* The ids, not a count. An id is the only handle on an entry,
                  so "sent 5" would leave the user unable to find any of them. */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {sent.map((id) => (
                  <Status key={id} tone="ok">
                    {id}
                  </Status>
                ))}
              </div>
            </Panel>
          )}
        </PageBody>
      </BoardState>
    </Page>
  );
}
