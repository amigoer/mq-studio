/**
 * RabbitMQ's routing vocabulary.
 *
 * The keys and shapes are a contract with internal/driver/rabbitmq/routing.go.
 */
import type { Binding } from "@bindings/model/models";

/**
 * The default exchange has no name of its own.
 *
 * Every queue is bound to it implicitly by its own name, so it is worth
 * spelling out: a reader seeing a blank source cell has no way to tell that is
 * the answer rather than a bug.
 */
export const DEFAULT_EXCHANGE = "amq.default";

/**
 * A binding is identified by all of these together, not by a name.
 *
 * The same exchange can bind to the same queue more than once with different
 * routing keys, and a headers exchange binds with no routing key at all and
 * tells its bindings apart by their arguments alone.
 */
export function bindingKey(binding: Binding): string {
  return [
    binding.source,
    binding.destinationKind,
    binding.destination,
    binding.routingKey,
    JSON.stringify(binding.arguments ?? {}),
  ].join(" ");
}

/**
 * Whether a binding routes on its key at all.
 *
 * A fanout ignores the key and a headers exchange matches on arguments
 * instead, so an empty key on those is the answer rather than a gap - and the
 * page has to say so rather than rendering a blank cell the reader has to
 * guess at.
 */
export function routesOnKey(binding: Binding): boolean {
  return binding.routingKey !== "";
}

/** Whether this binding targets another exchange rather than a queue. */
export function bindsExchange(binding: Binding): boolean {
  return binding.destinationKind === "exchange";
}

/** Bindings grouped by the exchange they leave, in one pass over the list. */
export function bindingsBySource(bindings: readonly Binding[]): Map<string, Binding[]> {
  const bySource = new Map<string, Binding[]>();
  for (const binding of bindings) {
    const existing = bySource.get(binding.source);
    if (existing) existing.push(binding);
    else bySource.set(binding.source, [binding]);
  }
  return bySource;
}
