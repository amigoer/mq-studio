import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectionScope } from "@/mq/ConnectionScope";
import * as messageApi from "@/api/message";
import { present } from "@/api/client";
import type { MessageItem, TailCursor } from "@/api/models";
import { formatErrorMessage } from "@/lib/utils";

/** How often the tail asks. Fast enough to read as live, slow enough to be cheap. */
export const TAIL_INTERVAL_MS = 2_000;

/** How many rows the tail keeps before the oldest fall off. */
export const TAIL_BUFFER = 500;

export interface MessageTail {
  /** Newest first, which is the order the results table already reads in. */
  messages: MessageItem[];
  /** Messages that aged out of the log between two polls. */
  dropped: number;
  running: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  clear: () => void;
}

/**
 * Follows a topic's newest messages.
 *
 * The loop is here rather than in Go, and the reason is lifetime: a goroutine
 * started on a page's behalf outlives the page the first time the renderer
 * forgets to stop it, while an interval in a hook is cleaned up by the same
 * unmount that took the page away. Go makes the poll incremental — it hands
 * back a cursor and returns only what arrived since — which is the part a
 * renderer cannot do for itself.
 *
 * A tail opens on what happens next: the first poll sends no cursor, which the
 * driver reads as "start at the end". What is already stored is what the query
 * above it is for.
 */
export function useMessageTail(topic: string): MessageTail {
  const { id: connID, online } = useConnectionScope();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [dropped, setDropped] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs, not state: the interval closes over them, and a cursor that arrived
  // through a re-render would restart the timer on every batch.
  const cursor = useRef<TailCursor>({ positions: [] });
  const inFlight = useRef(false);

  const stop = useCallback(() => setRunning(false), []);

  const clear = useCallback(() => {
    cursor.current = { positions: [] };
    setMessages([]);
    setDropped(0);
    setError(null);
  }, []);

  const start = useCallback(() => {
    clear();
    setRunning(true);
  }, [clear]);

  // A tail belongs to the topic it was started on; changing the topic ends it
  // rather than silently following the new one.
  useEffect(() => {
    setRunning(false);
    clear();
  }, [clear, topic, connID]);

  useEffect(() => {
    if (!running || topic === "" || !online) return;

    let cancelled = false;
    const poll = async () => {
      // One request at a time: a slow broker must not queue up polls that all
      // arrive together and reorder the tail.
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const batch = await messageApi.tailMessages(connID, topic, cursor.current, 64);
        if (cancelled) return;
        cursor.current = batch.cursor;
        setError(null);
        if (batch.dropped > 0) setDropped((current) => current + batch.dropped);
        const arrived = present(batch.messages);
        if (arrived.length > 0) {
          setMessages((current) =>
            // The batch is oldest first; the table reads newest first.
            [...arrived.reverse(), ...current].slice(0, TAIL_BUFFER),
          );
        }
      } catch (failure) {
        if (!cancelled) setError(formatErrorMessage(failure));
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), TAIL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [connID, online, running, topic]);

  return { messages, dropped, running, error, start, stop, clear };
}
