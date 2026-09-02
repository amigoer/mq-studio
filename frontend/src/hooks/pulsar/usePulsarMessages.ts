import { useCallback } from "react";
import { tailMessages, type TailBatch, type TailCursor } from "@/api/message";
import { browsePulsarMessages, type MessageItem } from "@/api/pulsar";
import { useBrokerData, type BrokerData } from "@/hooks/useBrokerData";

export interface PulsarQuery {
  /** The full topic URL, which is what addresses a Pulsar topic. */
  topic: string;
  messageId: string;
  messageKey: string;
  /** A "name=value" or bare-name property filter, or "". */
  property: string;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * A browse of one topic.
 *
 * Every filter but the id is applied after reading - Pulsar has no
 * message-search endpoint - so a query is a bounded walk of the log rather
 * than a lookup, and the refresh is manual for the same reason.
 */
export function usePulsarMessages(
  query: PulsarQuery | null,
  maxResults: number,
): BrokerData<MessageItem[]> {
  return useBrokerData(
    useCallback(
      (connID: number) => {
        if (query == null) throw new Error("nothing to query");
        // The property filter is Pulsar's own, and takes the place of the tag
        // every other family narrows by.
        return browsePulsarMessages(
          connID,
          query.topic,
          {
            messageId: query.messageId,
            messageKey: query.messageKey,
            property: query.property,
            startTimeMs: query.startTimeMs,
            endTimeMs: query.endTimeMs,
          },
          maxResults,
        );
      },
      [query, maxResults],
    ),
    { enabled: query != null, refreshMs: null },
  );
}

/** One poll of a tail, driven by the board's own interval. */
export function pulsarTail(
  connID: number,
  topic: string,
  cursor: TailCursor,
  limit: number,
): Promise<TailBatch> {
  return tailMessages(connID, topic, cursor, limit);
}
