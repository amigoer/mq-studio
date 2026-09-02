import { useCallback, useState } from "react";
import { MessageService } from "@bindings/bridge";
import type { MessageItem } from "@/api/models";
import { present } from "@/api/client";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";
import {
  FilterHeaderName,
  FilterHeaderValue,
  FilterStartSeq,
  FilterSubject,
} from "@/mq/nats/messages";

/** What the browse form collects. */
export interface BrowseQuery {
  stream: string;
  subject: string;
  startSeq: string;
  headerName: string;
  headerValue: string;
  limit: number;
}

export interface BrowseState {
  messages: MessageItem[];
  loading: boolean;
  error: string | null;
  /** True once a search has been run, so the empty state can say which it is. */
  searched: boolean;
}

/**
 * Browsing a stream.
 *
 * Not useBrokerData, and the difference matters: a browse is a search somebody
 * asks for, not a figure that refreshes itself. Polling it would re-read a
 * stream every thirty seconds for a page nobody is looking at, and would
 * silently replace the results under a reader who had scrolled.
 *
 * It goes through the canonical message API, whose Query carries a filters map
 * for exactly this - what only NATS has travels in there under the keys
 * internal/driver/nats/message.go reads.
 */
export function useNatsBrowse(): BrowseState & { run: (query: BrowseQuery) => Promise<void> } {
  const { id: connID } = useConnectionScope();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = useCallback(
    async (query: BrowseQuery) => {
      if (query.stream.trim() === "") return;
      setLoading(true);
      setError(null);
      try {
        const found = await MessageService.Query(connID, {
          topic: query.stream.trim(),
          key: "",
          tag: "",
          maxResults: query.limit,
          startTime: 0,
          endTime: 0,
          filters: {
            [FilterSubject]: query.subject.trim(),
            [FilterStartSeq]: query.startSeq.trim(),
            [FilterHeaderName]: query.headerName.trim(),
            [FilterHeaderValue]: query.headerValue.trim(),
          },
        }).then(present);
        setMessages(found);
      } catch (queryError) {
        setError(formatErrorMessage(queryError));
        setMessages([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    },
    [connID],
  );

  return { messages, loading, error, searched, run };
}
