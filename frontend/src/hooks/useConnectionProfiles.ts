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
  addConnection,
  connect as connectProfile,
  deleteConnection,
  disconnect as disconnectProfile,
  getConnections,
  setDefaultConnection,
  testConnection,
  updateConnection,
  type ConnectionDraft,
  type CredentialsMode,
} from "@/api/connection";
import type { Connection as ConnectionProfile } from "@/api/models";
import { toShellConnection, type Connection } from "@/design/data/connections";
import { formatErrorMessage } from "@/lib/utils";

/** What a row is currently doing, so it can say so and refuse a second click. */
export type ConnectionOp = "connecting" | "disconnecting" | "testing";

/**
 * The outcome of one dial, returned rather than only recorded.
 *
 * The caller needs the message in the same turn it made the call, and the
 * `errors` map it would otherwise read is the previous render's copy.
 */
export type ConnectionResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

/**
 * The stored connection profiles and their runtime state, shared by the list,
 * the tab strip and the command palette so all three see one set.
 *
 * Distinct from `useConnections`, which the shipped app used: that one polls on
 * a timer and opens the default connection on mount. This one dials only when
 * something asks it to, because the shell's tabs are what decide which
 * connections should be open.
 */
interface ConnectionProfilesContextValue {
  connections: readonly Connection[];
  /**
   * The same profiles unmapped. The edit form needs the fields the shell row
   * drops - timeout, options, which secrets are set - and reading them back
   * off the shell shape would mean widening it for one screen.
   */
  profiles: readonly ConnectionProfile[];
  loading: boolean;
  /** In-flight operation per connection id; absent when the row is idle. */
  pending: Readonly<Record<number, ConnectionOp | undefined>>;
  /** Message from the last failed connect or test, cleared by a success. */
  errors: Readonly<Record<number, string | undefined>>;
  reload: () => Promise<void>;
  remove: (id: number) => Promise<void>;
  makeDefault: (id: number) => Promise<void>;
  connect: (id: number) => Promise<ConnectionResult>;
  disconnect: (id: number) => Promise<ConnectionResult>;
  test: (id: number) => Promise<ConnectionResult>;
  create: (draft: ConnectionDraft) => Promise<ConnectionProfile>;
  update: (
    id: number,
    draft: ConnectionDraft,
    credentialsMode: CredentialsMode,
  ) => Promise<ConnectionProfile>;
}

const ConnectionProfilesContext = createContext<ConnectionProfilesContextValue | null>(null);

/** `12ms` / `1.4s` — the canvas prints latency beside an online row. */
export function latencyLabel(milliseconds: number): string {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1000).toFixed(1)}s`;
}

function useConnectionProfilesStore(): ConnectionProfilesContextValue {
  const [profiles, setProfiles] = useState<readonly ConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Record<number, ConnectionOp | undefined>>({});
  const [errors, setErrors] = useState<Record<number, string | undefined>>({});
  // Measured, not invented: the round trip of the connect or test that last
  // succeeded. The canvas drew a latency figure and this is the only one the
  // admin protocol actually gives us.
  const [latency, setLatency] = useState<Record<number, string | undefined>>({});

  const load = useCallback(async () => {
    setProfiles(await getConnections());
  }, []);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    getConnections()
      .then((loaded) => {
        if (!cancelled) setProfiles(loaded);
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

  const setOp = useCallback((id: number, op: ConnectionOp | undefined) => {
    setPending((current) => {
      const next = { ...current };
      if (op == null) delete next[id];
      else next[id] = op;
      return next;
    });
  }, []);

  const setError = useCallback((id: number, message: string | undefined) => {
    setErrors((current) => {
      if (message == null && current[id] == null) return current;
      const next = { ...current };
      if (message == null) delete next[id];
      else next[id] = message;
      return next;
    });
  }, []);

  /** Runs one dial, timing it and recording what it left behind. */
  const dial = useCallback(
    async (id: number, op: ConnectionOp, call: () => Promise<unknown>): Promise<ConnectionResult> => {
      setOp(id, op);
      const started = performance.now();
      try {
        await call();
        const latencyMs = performance.now() - started;
        setError(id, undefined);
        setLatency((current) => ({ ...current, [id]: latencyLabel(latencyMs) }));
        return { ok: true, latencyMs };
      } catch (error) {
        const message = formatErrorMessage(error);
        setError(id, message);
        return { ok: false, error: message };
      } finally {
        setOp(id, undefined);
        // Connecting and testing both stamp the profile, so the row's status
        // and "last used" columns are stale until this lands.
        await load().catch(() => {});
      }
    },
    [load, setError, setOp],
  );

  const connect = useCallback(
    (id: number) => dial(id, "connecting", () => connectProfile(id)),
    [dial],
  );

  const test = useCallback(
    (id: number) => dial(id, "testing", () => testConnection(id)),
    [dial],
  );

  const disconnect = useCallback(
    async (id: number) => {
      const result = await dial(id, "disconnecting", () => disconnectProfile(id));
      // A closed connection has no round trip to report any more.
      setLatency((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return result;
    },
    [dial],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteConnection(id);
      setError(id, undefined);
      await load();
    },
    [load, setError],
  );

  const makeDefault = useCallback(
    async (id: number) => {
      await setDefaultConnection(id);
      await load();
    },
    [load],
  );

  const create = useCallback(
    async (draft: ConnectionDraft) => {
      const created = await addConnection(draft);
      await load();
      return created;
    },
    [load],
  );

  const update = useCallback(
    async (id: number, draft: ConnectionDraft, credentialsMode: CredentialsMode) => {
      const updated = await updateConnection(id, draft, credentialsMode);
      setError(id, undefined);
      await load();
      return updated;
    },
    [load, setError],
  );

  // Go stores only online and offline. "Failed" is this session's knowledge:
  // a profile Go calls offline that we just failed to reach is a different
  // thing from one nobody has dialled, and the list draws them differently.
  const connections = useMemo(
    () =>
      profiles.map((profile) => {
        const shell = toShellConnection(profile);
        if (shell.status === "online") {
          return { ...shell, latency: latency[profile.id] };
        }
        return errors[profile.id] != null ? { ...shell, status: "failed" as const } : shell;
      }),
    [errors, latency, profiles],
  );

  return useMemo(
    () => ({
      connections,
      profiles,
      loading,
      pending,
      errors,
      reload,
      remove,
      makeDefault,
      connect,
      disconnect,
      test,
      create,
      update,
    }),
    [
      connect,
      connections,
      create,
      profiles,
      disconnect,
      errors,
      loading,
      makeDefault,
      pending,
      reload,
      remove,
      test,
      update,
    ],
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
