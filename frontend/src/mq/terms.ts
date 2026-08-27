/**
 * Terminology resolution.
 *
 * Calling a RabbitMQ queue a "Topic" is wrong; calling a Kafka topic a
 * "Destination" is bureaucratic. Each family names the canonical nouns in its
 * own i18n namespace and the pages read through here, falling back to the
 * neutral word for a family that has not been given one.
 *
 * Terms are pure presentation, so they live in the translation bundle rather
 * than crossing the bridge in a driver descriptor.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useConnections } from "@/hooks/useConnections";
import { registeredKinds } from "./registry";

/** The canonical nouns a family can rename. */
export type TermKey =
  | "destination"
  | "destinationPlural"
  | "subscription"
  | "subscriptionPlural"
  | "node"
  | "nodePlural"
  | "namespace"
  | "backlog";

export interface Terms {
  /** The family's word for a canonical noun. */
  (key: TermKey): string;
  /** The i18n key, for callers that need to interpolate. */
  key: (key: TermKey) => string;
}

/**
 * Resolves a noun against the active connection's family.
 *
 * The lookup is by kind rather than by anything the backend sends, because a
 * translation belongs in the bundle that ships the rest of the language.
 */
export function useTerms(): Terms {
  const { t, i18n } = useTranslation();
  const { active } = useConnections();

  // With nothing connected there is no family to ask, but the neutral word is
  // the wrong answer while only one driver is compiled in: its vocabulary is
  // the product's vocabulary, and showing "Destinations" on a RocketMQ-only
  // build reads as a placeholder rather than as precision.
  const registered = registeredKinds();
  const kind =
    active?.kind ?? (registered.length === 1 ? registered[0] : undefined);

  const keyOf = useCallback(
    (term: TermKey) => {
      const scoped = `mq.${kind}.terms.${term}`;
      return kind && i18n.exists(scoped) ? scoped : `mq.common.terms.${term}`;
    },
    [kind, i18n],
  );

  const resolve = useCallback((term: TermKey) => t(keyOf(term)), [t, keyOf]);
  const terms = resolve as Terms;
  terms.key = keyOf;
  return terms;
}
