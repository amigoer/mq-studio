import { useCallback, useState } from "react";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import * as messageApi from "@/api/message";
import {
  FILTER_BODY,
  FILTER_HEADER,
  FILTER_ROUTING_KEY,
} from "@/mq/rabbitmq/messages";
import type { MessageItem } from "@/api/models";

export interface BrowseRequest {
  queue: string;
  count: number;
  routingKey?: string;
  body?: string;
  header?: string;
}

export interface RabbitMessages {
  items: MessageItem[];
  /** True while a browse is in flight. */
  running: boolean;
  /** How many the last browse returned, or null before the first one. */
  lastCount: number | null;
  browse: (request: BrowseRequest) => Promise<void>;
  /** Shaped for BoardState, which every board's empty and error states use. */
  state: {
    loading: boolean;
    error: string | null;
    online: boolean;
    refresh: () => Promise<void>;
  };
}

/**
 * Browsing, which is a gesture rather than a poll.
 *
 * Deliberately not useBrokerData: every browse takes messages off the queue
 * and puts them back, so a page that re-read itself every thirty seconds would
 * be flagging real traffic as redelivered on a timer. It runs when someone
 * asks and not otherwise.
 */
export function useRabbitMessages(): RabbitMessages {
  const { id: connID, online } = useConnectionScope();
  const [items, setItems] = useState<MessageItem[]>([]);
  const [running, setRunning] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<BrowseRequest | null>(null);

  const browse = useCallback(
    async (request: BrowseRequest) => {
      if (connID <= 0) return;
      setRunning(true);
      setError(null);
      setLast(request);
      try {
        const found = await messageApi.browseMessages(connID, request.queue, request.count, {
          [FILTER_ROUTING_KEY]: request.routingKey ?? "",
          [FILTER_HEADER]: request.header ?? "",
          [FILTER_BODY]: request.body ?? "",
        });
        setItems(found);
        setLastCount(found.length);
      } catch (browseError) {
        setItems([]);
        setLastCount(null);
        setError(formatErrorMessage(browseError));
      } finally {
        setRunning(false);
      }
    },
    [connID],
  );

  const refresh = useCallback(async () => {
    if (last != null) await browse(last);
  }, [browse, last]);

  return {
    items,
    running,
    lastCount,
    browse,
    state: { loading: running && items.length === 0, error, online, refresh },
  };
}
