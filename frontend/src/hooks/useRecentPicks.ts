import { useCallback, useEffect, useState } from "react";
import { useConnectionScope } from "@/mq/ConnectionScope";
import {
  loadRecentPicks,
  recordRecentPick,
  type PickKind,
} from "@/lib/recentPicks";

/**
 * The topics or consumer groups last used on this page's connection, newest first.
 *
 * Scoped per connection so a cluster never suggests names from another one.
 * `record` is meant for the moment the value is actually used — a send that
 * succeeded, a query that ran — not for merely picking it in a dropdown.
 */
export function useRecentPicks(kind: PickKind) {
  const { key: activeKey } = useConnectionScope();
  const [recent, setRecent] = useState<string[]>(() =>
    loadRecentPicks(activeKey, kind),
  );

  useEffect(() => {
    setRecent(loadRecentPicks(activeKey, kind));
  }, [activeKey, kind]);

  const record = useCallback(
    (value: string) => setRecent(recordRecentPick(activeKey, kind, value)),
    [activeKey, kind],
  );

  return { recent, record };
}
