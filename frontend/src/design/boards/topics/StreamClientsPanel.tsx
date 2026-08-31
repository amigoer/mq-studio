import { useTranslation } from "react-i18next";
import { Capability } from "@bindings/model/models";
import { KV, Panel, SectionLabel, Status } from "@/components";
import { Spinner } from "@/components/ui/spinner";
import { Capable } from "@/mq/Capable";
import { useRabbitStreamClients } from "@/hooks/rabbitmq/useRabbitStreamClients";
import { formatCount } from "@/lib/format";
import { present } from "@/api/client";
import type { StreamConsumer, StreamPublisher } from "@/api/rabbitmq";

const TAG = { fontSize: "10px" } as const;
const MONO11 = { fontSize: "11px" } as const;
const MUTED = { fontSize: "11.5px", color: "var(--c-muted)" } as const;

/**
 * Who is attached to a stream over the stream protocol.
 *
 * The reason this panel exists at all: a stream protocol client connects on
 * its own port and never appears among a queue's AMQP consumers. A stream
 * three applications are reading reports zero consumers everywhere else in
 * this app, and a queue detail that only showed that number would be saying
 * nobody is reading it.
 *
 * Only for stream queues, so the caller decides when to render it. The plugin
 * behind it is optional, which is what the fallback covers - a broker without
 * it still serves the stream over AMQP, and only this section goes dark.
 */
export function StreamClientsPanel({ vhost, name }: { vhost: string; name: string }) {
  const { t } = useTranslation();

  return (
    <Capable
      of={Capability.CapStreamClients}
      fallback={(reason) => (
        <div>
          <SectionLabel style={{ marginBottom: "6px" }}>
            {t("board.topics.rabbitmq.streamClients")}
          </SectionLabel>
          <Panel style={{ padding: "9px 12px", ...MUTED }}>{t(reason)}</Panel>
        </div>
      )}
    >
      <StreamClients vhost={vhost} name={name} />
    </Capable>
  );
}

function StreamClients({ vhost, name }: { vhost: string; name: string }) {
  const { t } = useTranslation();
  const state = useRabbitStreamClients(vhost, name);
  const publishers = present(state.data?.publishers);
  const consumers = present(state.data?.consumers);

  return (
    <div>
      <SectionLabel style={{ marginBottom: "6px" }}>
        {t("board.topics.rabbitmq.streamClients")}
      </SectionLabel>
      {state.loading ? (
        <Panel style={{ padding: "9px 12px", ...MUTED }}>
          <Spinner className="size-3" /> {t("board.state.loading")}
        </Panel>
      ) : state.error != null ? (
        <Panel style={{ padding: "9px 12px", fontSize: "11.5px", color: "var(--c-err-text)" }}>
          {state.error}
        </Panel>
      ) : publishers.length === 0 && consumers.length === 0 ? (
        /* Worth a sentence rather than a blank: a stream with no stream
           protocol clients is normal, and the reader has to know that the
           consumers it does have are counted somewhere else. */
        <Panel style={{ padding: "9px 12px", ...MUTED }}>
          {t("board.topics.rabbitmq.noStreamClients")}
        </Panel>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {publishers.map((publisher, index) => (
            <PublisherCard key={`${publisher.connection}-${index}`} publisher={publisher} />
          ))}
          {consumers.map((consumer, index) => (
            <ConsumerCard key={`${consumer.connection}-${index}`} consumer={consumer} />
          ))}
        </div>
      )}
    </div>
  );
}

function PublisherCard({ publisher }: { publisher: StreamPublisher }) {
  const { t } = useTranslation();
  return (
    <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <Status tone="ok" style={TAG}>
          {t("board.topics.rabbitmq.streamPublisher")}
        </Status>
        <span className="mono3" style={MONO11}>
          {publisher.peerHost || publisher.connection || "—"}
        </span>
      </div>
      <KV
        rows={[
          [
            /* The reference is what the broker deduplicates on across a
               reconnect. Without one a publisher that reconnects mid-batch
               writes its messages twice, so its absence is a fact about the
               client rather than a missing field. */
            t("board.topics.rabbitmq.streamReference"),
            publisher.reference !== ""
              ? publisher.reference
              : t("board.topics.rabbitmq.noStreamReference"),
          ],
          [t("board.topics.rabbitmq.streamPublished"), formatCount(publisher.published)],
          [t("board.topics.rabbitmq.streamConfirmed"), formatCount(publisher.confirmed)],
          ...(publisher.errored > 0
            ? ([
                [
                  t("board.topics.rabbitmq.streamErrored"),
                  <span key="e" style={{ color: "var(--c-err-text)" }}>
                    {formatCount(publisher.errored)}
                  </span>,
                ],
              ] as const)
            : []),
          ...(publisher.user !== ""
            ? ([[t("board.common.user"), publisher.user]] as const)
            : []),
        ]}
      />
    </Panel>
  );
}

function ConsumerCard({ consumer }: { consumer: StreamConsumer }) {
  const { t } = useTranslation();
  return (
    <Panel style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {/* An inactive subscription is a single-active-consumer standby
            waiting its turn, which is working rather than stuck. */}
        <Status tone={consumer.active ? "ok" : "off"} style={TAG}>
          {consumer.active
            ? t("board.topics.rabbitmq.streamConsumer")
            : t("board.topics.rabbitmq.streamStandby")}
        </Status>
        <span className="mono3" style={MONO11}>
          {consumer.peerHost || consumer.connection || "—"}
        </span>
      </div>
      <KV
        rows={[
          [t("board.topics.rabbitmq.streamOffset"), formatCount(consumer.offset)],
          [
            /* A stream keeps its messages after they are read, so there is no
               depth to fall behind on. Lag is the only thing that says whether
               a consumer is keeping up. */
            t("board.topics.rabbitmq.streamLag"),
            <span key="lag" style={consumer.lag > 0 ? { color: "var(--c-warn-text)" } : undefined}>
              {formatCount(consumer.lag)}
            </span>,
          ],
          [t("board.topics.rabbitmq.streamConsumed"), formatCount(consumer.consumed)],
          ...(consumer.user !== "" ? ([[t("board.common.user"), consumer.user]] as const) : []),
        ]}
      />
    </Panel>
  );
}
