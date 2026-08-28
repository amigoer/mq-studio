/**
 * The navigation entries the active driver contributes.
 *
 * A module only earns one when its page has no canonical counterpart at all -
 * RabbitMQ's exchanges and bindings being the case the override rule was
 * written for. Everything else contributes columns to a canonical page
 * instead.
 */
import { useMemo } from "react";
import { useConnections } from "@/hooks/useConnections";
import { moduleFor } from "./registry";
import type { NavContribution } from "./types";

export function useModuleNav(): NavContribution[] {
  const { active } = useConnections();
  return useMemo(() => moduleFor(active?.kind)?.nav ?? [], [active?.kind]);
}
