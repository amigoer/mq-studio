import type { ReactElement, ReactNode } from "react";
import type { Capability } from "@bindings/model/models";
import { useCapabilities } from "./capabilities";

/**
 * Renders children only when the connection can do this.
 *
 * A capability the endpoint lacks for a stated reason renders the fallback
 * instead of vanishing, so a limit the user can act on stays visible. One the
 * family has no concept of renders nothing at all - there is nothing to
 * explain about a control that never made sense here.
 */
export function Capable({
  of,
  children,
  fallback,
}: {
  of: Capability;
  children: ReactNode;
  /** Shown when the endpoint reports a reason. Receives that reason. */
  fallback?: (reason: string) => ReactElement | null;
}): ReactNode {
  const { has, degradedReason } = useCapabilities();

  if (has(of)) return children;

  const reason = degradedReason(of);
  if (reason && fallback) return fallback(reason);
  return null;
}
