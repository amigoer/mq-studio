import { useCallback, useEffect, useRef, useState } from "react";
import {
  pollMqttSubscription,
  startMqttSubscription,
  stopMqttSubscription,
  type MQTTSubscribeInput,
} from "@/api/mqtt";
import type { LiveMessage } from "@/api/models";
import { useConnectionScope } from "@/mq/ConnectionScope";
import { formatErrorMessage } from "@/lib/utils";

/** How often the renderer drains the buffer the driver is filling. */
const POLL_MS = 400;

/** How many messages the panel holds. The driver's ring bounds its own. */
const KEEP = 500;

export interface MqttStream {
  /** Newest last, the order the stream appends in. */
  messages: LiveMessage[];
  /** True while a subscription is open. */
  running: boolean;
  /**
   * False when the session behind the stream dropped. The subscription
   * survives - a reconnect re-establishes it - so this is the difference
   * between "nothing is being published" and "we stopped listening", which
   * look identical otherwise.
   */
  live: boolean;
  /** Every message this stream has seen, including any it had to drop. */
  received: number;
  /**
   * Messages lost because a buffer was full. A running total, and the reason
   * it is shown at all: a stream that is quietly losing and one that is quiet
   * are indistinguishable without it.
   */
  dropped: number;
  error: string | null;
  start: (input: MQTTSubscribeInput) => void;
  stop: () => void;
  clear: () => void;
}

/**
 * A live MQTT subscription, drained on a timer.
 *
 * A poll rather than a push, because the buffer it drains is on the Go side:
 * the broker pushes into a bounded ring per subscription and this drains it by
 * sequence. Pushing every message across the bridge would put a busy broker's
 * whole firehose through it for a panel showing the last few hundred lines.
 *
 * The subscription is real on the broker until it is stopped, so unmounting
 * stops it. A panel that closed without doing so would leave the session
 * receiving traffic nobody reads - and on a shared subscription, taking a
 * share of it away from a real consumer.
 */
export function useMqttStream(): MqttStream {
  const { id: connID } = useConnectionScope();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(true);
  const [received, setReceived] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refs rather than state: the poll loop reads them every tick and must not
  // be torn down and rebuilt for a cursor that moves several times a second.
  const subscription = useRef<string | null>(null);
  const cursor = useRef(0);
  const connection = useRef(connID);
  connection.current = connID;

  const stop = useCallback(() => {
    const id = subscription.current;
    subscription.current = null;
    setRunning(false);
    if (id == null || connection.current === 0) return;
    // The stop is fire and forget: the panel is already closing, and a failure
    // to unsubscribe is the broker's to notice on the next disconnect.
    void stopMqttSubscription(connection.current, id).catch(() => {});
  }, []);

  const start = useCallback(
    (input: MQTTSubscribeInput) => {
      const id = connection.current;
      if (id === 0) return;

      // One stream per panel. Starting a second without stopping the first
      // would leak a subscription on the broker with nothing reading it.
      const previous = subscription.current;
      if (previous != null) {
        subscription.current = null;
        void stopMqttSubscription(id, previous).catch(() => {});
      }

      setError(null);
      setMessages([]);
      setReceived(0);
      setDropped(0);
      setLive(true);
      cursor.current = 0;

      void startMqttSubscription(id, input)
        .then((started) => {
          subscription.current = started.id;
          setRunning(true);
        })
        .catch((cause: unknown) => {
          setError(formatErrorMessage(cause));
          setRunning(false);
        });
    },
    [],
  );

  const clear = useCallback(() => setMessages([]), []);

  useEffect(() => {
    if (!running) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      const id = subscription.current;
      const conn = connection.current;
      if (id == null || conn === 0) return;

      void pollMqttSubscription(conn, id, cursor.current, KEEP)
        .then((batch) => {
          if (cancelled) return;
          cursor.current = batch.cursor;
          setReceived(batch.received);
          setDropped(batch.dropped);
          setLive(batch.live);
          const arrived = (batch.messages ?? []).filter(
            (message): message is LiveMessage => message != null,
          );
          if (arrived.length === 0) return;
          // Trimmed here as well as in the driver: the ring bounds what the Go
          // side holds between polls, and this bounds what one panel keeps
          // across a session that may run for hours.
          setMessages((held) => [...held, ...arrived].slice(-KEEP));
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          setError(formatErrorMessage(cause));
          setRunning(false);
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running]);

  // Unmounting stops the subscription on the broker, not just the polling.
  useEffect(() => stop, [stop]);

  return { messages, running, live, received, dropped, error, start, stop, clear };
}
