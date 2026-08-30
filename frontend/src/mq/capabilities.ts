/**
 * Capability gating.
 *
 * Three states reach the UI and they must stay distinguishable. A supported
 * capability renders normally. One the endpoint cannot do renders disabled
 * with the driver's reason. One the family has no concept of is hidden
 * outright. Collapsing the middle case into the last is what makes a
 * deliberately limited endpoint - a RocketMQ Proxy, an MQTT broker - read as
 * a bug rather than a fact.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Capabilities, Capability } from "@bindings/model/models";
import * as driverApi from "@/api/driver";
import { useConnectionScope } from "./ConnectionScope";

export interface CapabilityState {
  /** True when the connection can do this. */
  has: (capability: Capability) => boolean;
  /** Set when the family has this but the endpoint does not. */
  degradedReason: (capability: Capability) => string | undefined;
  /** Set when it works but has a consequence worth warning about. */
  caveat: (capability: Capability) => string | undefined;
  loading: boolean;
}

const empty: Capabilities = {
  supported: [],
  degraded: {},
  caveats: {},
} as Capabilities;

const CapabilityContext = createContext<CapabilityState | null>(null);

function useCapabilityState(): CapabilityState {
  const { id: connID, online } = useConnectionScope();
  const [capabilities, setCapabilities] = useState<Capabilities>(empty);
  const [loading, setLoading] = useState(true);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);
    // No connection means nothing is supported, which is a real answer rather
    // than an error: the shell renders before anything is dialled.
    if (connID === 0 || !online) {
      setCapabilities(empty);
      setLoading(false);
      return;
    }
    driverApi
      .getCapabilities(connID)
      .then((next) => {
        if (!cancelled.current) setCapabilities(next);
      })
      .catch(() => {
        if (!cancelled.current) setCapabilities(empty);
      })
      .finally(() => {
        if (!cancelled.current) setLoading(false);
      });
    return () => {
      cancelled.current = true;
    };
  }, [connID, online]);

  const supported = useMemo(
    () => new Set<string>(capabilities.supported ?? []),
    [capabilities.supported],
  );

  const has = useCallback(
    (capability: Capability) => supported.has(capability),
    [supported],
  );
  const degradedReason = useCallback(
    (capability: Capability) => capabilities.degraded?.[capability],
    [capabilities.degraded],
  );
  const caveat = useCallback(
    (capability: Capability) => capabilities.caveats?.[capability],
    [capabilities.caveats],
  );

  // Memoised because it is a context value: a fresh object every render would
  // re-run the navigation derivation in every consumer for nothing.
  return useMemo(
    () => ({ has, degradedReason, caveat, loading }),
    [caveat, degradedReason, has, loading],
  );
}

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const value = useCapabilityState();
  return createElement(CapabilityContext.Provider, { value }, children);
}

/** Reads the scoped connection's capabilities. */
export function useCapabilities(): CapabilityState {
  const ctx = useContext(CapabilityContext);
  if (!ctx)
    throw new Error("useCapabilities must be used within CapabilitiesProvider");
  return ctx;
}
