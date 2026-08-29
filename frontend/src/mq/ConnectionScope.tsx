/**
 * The connection a page is reading.
 *
 * Every bridge method names its connection by id, and the shell opens one tab
 * per connection, so a board cannot ask "the active connection" - it has to be
 * told which one it is inside. This carries that down without threading an id
 * through every board's props.
 *
 * It replaces `useConnections`, which polled the profile list and published a
 * single active connection. That was the right shape while one client could be
 * open at a time; it is the wrong one now.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MQKind } from "@bindings/model/models";
import type { Connection as ConnectionProfile } from "@/api/models";

export interface ConnectionScope {
  /** The profile id every request on this page runs against, 0 when none. */
  id: number;
  /** The family, for terminology and capability lookups. */
  kind: MQKind | undefined;
  /**
   * A stable key for anything stored per connection. Distinct from the id so
   * per-connection storage survives nothing in particular being open.
   */
  key: string;
  /** False when the profile exists but nothing is dialled. */
  online: boolean;
}

const NONE: ConnectionScope = { id: 0, kind: undefined, key: "", online: false };

const Context = createContext<ConnectionScope>(NONE);

export function ConnectionScopeProvider({
  profile,
  children,
}: {
  profile: ConnectionProfile | undefined;
  children: ReactNode;
}) {
  const scope = useMemo<ConnectionScope>(
    () =>
      profile == null
        ? NONE
        : {
            id: profile.id,
            kind: profile.kind,
            key: String(profile.id),
            online: profile.status === "online",
          },
    [profile],
  );
  return <Context.Provider value={scope}>{children}</Context.Provider>;
}

/** The connection this page is reading. */
export function useConnectionScope(): ConnectionScope {
  return useContext(Context);
}
