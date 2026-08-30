import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Panel, SectionLabel } from "@/components";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as messageApi from "@/api/message";
import type { ProducerClient } from "@/api/message";
import { formatErrorMessage } from "@/lib/utils";

/**
 * Who is currently publishing under a named producer group.
 *
 * The group is typed rather than picked, and that is a fact about the broker
 * rather than an unfinished control: connections are indexed by producer group
 * and no call enumerates the groups, so this answers "is anything from this
 * service still connected" and not "who is writing here".
 *
 * It runs on request rather than on a timer. The answer is only meaningful
 * next to a group somebody had a reason to ask about.
 */
export function ProducerClients({ topic }: { topic: string }) {
  const { t } = useTranslation();
  const { id: connID, online } = useConnectionScope();
  const [group, setGroup] = useState("");
  const [clients, setClients] = useState<ProducerClient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = async () => {
    const name = group.trim();
    if (name === "" || !online) return;
    setLoading(true);
    setError(null);
    try {
      setClients(await messageApi.getProducers(connID, name, topic));
    } catch (failure) {
      setClients(null);
      setError(formatErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <SectionLabel>{t("board.producer.clients.title")}</SectionLabel>

      <div className="flex gap-2">
        <Input
          className="mono3 min-w-0 flex-1"
          value={group}
          placeholder={t("board.producer.clients.groupPlaceholder")}
          onChange={(event) => setGroup(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void query()}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={group.trim() === "" || !online || loading}
          onClick={() => void query()}
        >
          {loading && <Spinner />}
          {t("board.producer.clients.query")}
        </Button>
      </div>

      {error != null ? (
        <p className="m-0 text-xs leading-relaxed text-(--c-err)">{error}</p>
      ) : clients == null ? (
        <p className="m-0 text-xs leading-relaxed text-(--c-muted)">
          {t("board.producer.clients.hint")}
        </p>
      ) : clients.length === 0 ? (
        <p className="m-0 text-xs text-(--c-muted)">{t("board.producer.clients.none")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {clients.map((client) => (
            <div key={client.clientId} className="flex flex-col text-[11.5px]">
              <span className="mono3 truncate" title={client.clientId}>
                {client.clientId}
              </span>
              <span className="mono3 text-[10.5px] text-(--c-mono-dim)">
                {[client.address, client.language, client.version].filter(Boolean).join(" · ")}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
