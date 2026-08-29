import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deleteConnection,
  getConnections,
  setDefaultConnection,
} from "@/api/connection";
import { toShellConnection, type Connection } from "@/design/data/connections";

/**
 * The stored connection profiles, shared by the list, the tab strip and the
 * command palette so all three see one set.
 *
 * Distinct from `useConnections`, which the shipped app used: that one polls
 * and opens the default connection on mount. This one only reads and writes
 * the profiles -- nothing here dials a broker.
 */
interface ConnectionProfilesContextValue {
  connections: readonly Connection[];
  loading: boolean;
  reload: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  makeDefault: (id: number) => Promise<void>;
}

const ConnectionProfilesContext = createContext<ConnectionProfilesContextValue | null>(null);

function useConnectionProfilesStore(): ConnectionProfilesContextValue {
  const [connections, setConnections] = useState<readonly Connection[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const profiles = await getConnections();
    setConnections(profiles.map(toShellConnection));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getConnections()
      .then((profiles) => {
        if (!cancelled) setConnections(profiles.map(toShellConnection));
      })
      .catch(() => {
        // Off Wails, or before Go is up: an empty list is the honest answer,
        // and the empty state says so.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = useCallback(
    async (id: number) => {
      await deleteConnection(id);
      await reload();
    },
    [reload],
  );

  const makeDefault = useCallback(
    async (id: number) => {
      await setDefaultConnection(id);
      await reload();
    },
    [reload],
  );

  return useMemo(
    () => ({ connections, loading, reload, remove, makeDefault }),
    [connections, loading, makeDefault, reload, remove],
  );
}

export function ConnectionProfilesProvider({ children }: { children: ReactNode }) {
  const value = useConnectionProfilesStore();
  return createElement(ConnectionProfilesContext.Provider, { value }, children);
}

export function useConnectionProfiles(): ConnectionProfilesContextValue {
  const context = useContext(ConnectionProfilesContext);
  if (context == null) {
    throw new Error("useConnectionProfiles must be used within ConnectionProfilesProvider");
  }
  return context;
}
