import { useCallback, useRef, useState } from "react";
import { MessageService } from "@bindings/bridge";
import type { MessageItem, TailBatch, TailCursor } from "@/api/models";
import { present, required } from "@/api/client";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import { FilterMode, FilterPartition, FilterStartOffset, type ReadMode } from "@/mq/kafka/messages";

export interface KafkaReadQuery {
  topic: string;
  /** Null means every partition. */
  partition: number | null;
  mode: ReadMode;
  /** For the offset mode. */
  startOffset: string;
  /** Milliseconds, for the time mode. */
  startTime: number;
  /** For the key mode. */
  key: string;
  limit: number;
}

export interface KafkaReadState {
  records: MessageItem[];
  loading: boolean;
  error: string | null;
  /** False until a query has run, which is not the same as one that found nothing. */
  ran: boolean;
}

/**
 * Reading records is a query, not a subscription.
 *
 * Unlike every other Kafka board this one does not poll on a timer: a read is
 * a range of a log, and re-running it would either return the same records
 * forever or move under the reader. The board asks, and asks again when told.
 */
export function useKafkaRead() {
  const { id: connID } = useConnectionScope();
  const [state, setState] = useState<KafkaReadState>({
    records: [],
    loading: false,
    error: null,
    ran: false,
  });
  const generation = useRef(0);

  const run = useCallback(
    async (query: KafkaReadQuery) => {
      const current = ++generation.current;
      setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const filters: Record<string, string> = { [FilterMode]: query.mode };
        if (query.partition != null) filters[FilterPartition] = String(query.partition);
        if (query.mode === "offset") filters[FilterStartOffset] = query.startOffset.trim();

        const records = await MessageService.Query(connID, {
          topic: query.topic,
          key: query.mode === "key" ? query.key.trim() : "",
          tag: "",
          maxResults: query.limit,
          startTime: query.mode === "time" ? query.startTime : 0,
          endTime: 0,
          filters,
        }).then(present);

        if (current !== generation.current) return;
        setState({ records, loading: false, error: null, ran: true });
      } catch (failure) {
        if (current !== generation.current) return;
        setState({ records: [], loading: false, error: formatErrorMessage(failure), ran: true });
      }
    },
    [connID],
  );

  return { ...state, run };
}

/** How many records the tail panel keeps before the oldest scroll out. */
const TAIL_KEEP = 500;

/**
 * Following a topic's newest records.
 *
 * The caller owns the loop because the caller owns the lifetime: a tail still
 * polling after its page closed is the one failure mode worth designing out,
 * so this hands back a step rather than starting a timer of its own.
 */
export function useKafkaTail(topic: string) {
  const { id: connID } = useConnectionScope();
  const cursor = useRef<TailCursor>({ positions: [] });
  const [records, setRecords] = useState<MessageItem[]>([]);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    cursor.current = { positions: [] };
    setRecords([]);
    setDropped(0);
    setError(null);
  }, []);

  const step = useCallback(async () => {
    if (topic === "") return;
    try {
      const batch: TailBatch = await MessageService.Tail(
        connID,
        topic,
        cursor.current,
        200,
      ).then(required);
      cursor.current = batch.cursor;
      setError(null);
      // Counted rather than shown: records that aged out between two polls are
      // gone, and a tail that is silently losing looks like a quiet one.
      if (batch.dropped > 0) setDropped((total) => total + batch.dropped);
      const arrived = (batch.messages ?? []).filter(
        (record): record is MessageItem => record != null,
      );
      if (arrived.length > 0) {
        setRecords((previous) => [...previous, ...arrived].slice(-TAIL_KEEP));
      }
    } catch (failure) {
      setError(formatErrorMessage(failure));
    }
  }, [connID, topic]);

  return { records, dropped, error, step, reset };
}
