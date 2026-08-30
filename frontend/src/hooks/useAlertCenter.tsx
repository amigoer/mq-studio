/**
 * Every open connection's alerts, in one list.
 *
 * The alerts page reads the one connection its tab is scoped to. The bell in
 * the title bar cannot: alerts arrive across every connection the user has
 * open, and the popover groups them by connection, so this sits above
 * `ConnectionScope` and fans out for itself.
 *
 * It polls more slowly than a board does. A board watches one connection while
 * you look at it; this watches all of them for as long as the window is up, and
 * a bell that is one minute behind is a fair trade for not tripling the admin
 * traffic against every broker in the list.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import * as clusterApi from "@/api/cluster";
import * as consumerApi from "@/api/consumer";
import { present } from "@/api/client";
import type { MQKind } from "@bindings/model/models";
import type { Connection, Subscription } from "@/api/models";
import { useConnectionProfiles } from "@/hooks/useConnectionProfiles";
import { useAlertRules } from "@/hooks/useAlertRules";
import { useSettings } from "@/hooks/useSettings";
import { deriveAlerts, type AlertFacts, type DerivedAlert } from "@/lib/alertDerive";
import {
  loadReadIds,
  mergeAlerts,
  saveReadIds,
  unreadCount,
  type AlertRecord,
} from "@/lib/alertCenter";
import {
  requestDesktopNotifyPermission,
  sendDesktopNotification,
} from "@/lib/desktopNotify";
import { alertBody, alertTitle } from "@/lib/alertText";

/** Slower than a board's 30s, because this one runs against every connection. */
export const ALERT_POLL_MS = 60_000;

const NO_FACTS: AlertFacts = { nodes: [], consumerGroups: [] };

/** One connection's rows, in the order the popover draws them. */
export interface AlertGroup {
  connectionId: number;
  name: string;
  kind: MQKind | undefined;
  records: AlertRecord[];
}

interface AlertCenterValue {
  /** Grouped by connection, worst-affected connection first. */
  groups: AlertGroup[];
  /** Firing and unseen. What the bell's dot counts. */
  unread: number;
  /** True until the first sweep has settled. */
  loading: boolean;
  /** False when nothing is dialled, which is why the list is empty. */
  online: boolean;
  markAllRead: () => void;
  markRead: (id: string) => void;
  refresh: () => Promise<void>;
}

const AlertCenterContext = createContext<AlertCenterValue | null>(null);

/** A poll of one connection: null facts mean the request failed. */
type Sweep = { id: number; facts: AlertFacts | null };

async function sweepConnection(profile: Connection): Promise<Sweep> {
  if (profile.status !== "online") return { id: profile.id, facts: NO_FACTS };
  try {
    const [cluster, groups] = await Promise.all([
      clusterApi.getClusterView(profile.id),
      // Groups are the slowest read and the likeliest to fail on their own;
      // losing the broker rules with them would be the worse outcome.
      consumerApi.getConsumerGroups(profile.id).catch(() => [] as Subscription[]),
    ]);
    return {
      id: profile.id,
      facts: { nodes: present(cluster?.nodes), consumerGroups: groups },
    };
  } catch {
    // A request that did not answer is not evidence that anything cleared.
    return { id: profile.id, facts: null };
  }
}

function useAlertCenterStore(): AlertCenterValue {
  const { t } = useTranslation();
  const { profiles } = useConnectionProfiles();
  const { rules } = useAlertRules();
  const { settings } = useSettings();

  const [facts, setFacts] = useState<Record<number, AlertFacts | null>>({});
  const [records, setRecords] = useState<Record<string, AlertRecord>>({});
  const [loading, setLoading] = useState(true);

  const readIds = useRef<Set<string>>(loadReadIds());
  /*
   * A mirror of `records`, so the merge and the two read actions can run as
   * plain code rather than inside a state updater. Updaters must be pure, and
   * these three want to send a notification and touch localStorage.
   */
  const recordsRef = useRef<Record<string, AlertRecord>>({});
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const notifyRef = useRef(settings.desktopNotifications);
  notifyRef.current = settings.desktopNotifications;
  const translateRef = useRef(t);
  translateRef.current = t;

  /*
   * The identity of `profiles` changes on every reload the connection store
   * does, which is after every dial. Restarting the poll timer each time would
   * mean it never fires, so the effect below keys on which connections are
   * open rather than on the array.
   */
  const openKey = useMemo(
    () =>
      profiles
        .map((profile) => `${profile.id}:${profile.status}`)
        .sort()
        .join(","),
    [profiles],
  );

  const refresh = useCallback(async () => {
    const sweeps = await Promise.all(profilesRef.current.map(sweepConnection));
    setFacts((previous) => {
      const next: Record<number, AlertFacts | null> = {};
      for (const sweep of sweeps) {
        // Keep the last good read when this one failed, so the list holds
        // steady through a blip instead of emptying and refilling.
        next[sweep.id] = sweep.facts ?? previous[sweep.id] ?? null;
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), ALERT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [openKey, refresh]);

  /*
   * Derivation is separate from the sweep so a threshold or a rule toggle
   * reaches the bell at once, rather than at the next minute boundary.
   */
  const observed = useMemo(() => {
    const out = new Map<number, readonly DerivedAlert[]>();
    for (const [id, connectionFacts] of Object.entries(facts)) {
      if (connectionFacts == null) continue;
      out.set(
        Number(id),
        deriveAlerts(connectionFacts, rules, {
          lag: settings.lagAlertThreshold ?? 10000,
          disk: settings.diskAlertThreshold ?? 75,
        }),
      );
    }
    return out;
  }, [facts, rules, settings.lagAlertThreshold, settings.diskAlertThreshold]);

  const known = useMemo(
    () => new Set(profiles.map((profile) => profile.id)),
    [profiles],
  );

  useEffect(() => {
    /*
     * Re-running this on the same observation is a no-op: an alert already on
     * the list is neither new nor recovered, so `fired` comes back empty and
     * StrictMode's second pass announces nothing.
     */
    const { records: merged, fired } = mergeAlerts({
      previous: recordsRef.current,
      observed,
      known,
      read: readIds.current,
      now: Date.now(),
    });
    recordsRef.current = merged;
    setRecords(merged);

    if (fired.length === 0 || !notifyRef.current) return;
    // One banner per sweep, however many fired: a broker that drops takes its
    // groups with it, and five banners for one event is not five events.
    const translate = translateRef.current;
    const head = fired[0]!;
    const more = fired.length - 1;
    const name = profilesRef.current.find((p) => p.id === head.connectionId)?.name ?? "";
    const headline = alertTitle(translate, head);
    void sendDesktopNotification({
      title:
        more > 0
          ? translate("shell.notifications.desktopMore", { title: headline, count: more })
          : headline,
      body: name ? `${name} · ${alertBody(translate, head)}` : alertBody(translate, head),
      tag: `mq-studio-alert-${head.id}`,
    });
  }, [observed, known]);

  /*
   * Asked for when the switch goes on, not at launch: macOS remembers a denial
   * and a prompt the user did not ask for is the one they refuse. Turning the
   * setting off and on again re-asks, which is the only retry the OS allows.
   */
  useEffect(() => {
    if (!settings.desktopNotifications) return;
    void requestDesktopNotifyPermission();
  }, [settings.desktopNotifications]);

  const markAllRead = useCallback(() => {
    const next: Record<string, AlertRecord> = {};
    let changed = false;
    for (const [id, record] of Object.entries(recordsRef.current)) {
      if (record.read) {
        next[id] = record;
        continue;
      }
      readIds.current.add(id);
      next[id] = { ...record, read: true };
      changed = true;
    }
    if (!changed) return;
    saveReadIds(readIds.current);
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const markRead = useCallback((id: string) => {
    const record = recordsRef.current[id];
    if (record == null || record.read) return;
    readIds.current.add(id);
    saveReadIds(readIds.current);
    const next = { ...recordsRef.current, [id]: { ...record, read: true } };
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const groups = useMemo<AlertGroup[]>(() => {
    const byConnection = new Map<number, AlertRecord[]>();
    for (const record of Object.values(records)) {
      const bucket = byConnection.get(record.connectionId);
      if (bucket) bucket.push(record);
      else byConnection.set(record.connectionId, [record]);
    }
    const out: AlertGroup[] = [];
    // Connection order follows the profile list, so the popover reads in the
    // same order as the tab strip rather than by whichever id is lower.
    for (const profile of profiles) {
      const bucket = byConnection.get(profile.id);
      if (bucket == null || bucket.length === 0) continue;
      out.push({
        connectionId: profile.id,
        name: profile.name,
        kind: profile.kind,
        // Firing before recovered, then newest first within each.
        records: bucket.sort((left, right) => {
          const resolved = Number(left.resolvedAt != null) - Number(right.resolvedAt != null);
          return resolved !== 0 ? resolved : right.firstSeen - left.firstSeen;
        }),
      });
    }
    return out;
  }, [records, profiles]);

  return {
    groups,
    unread: unreadCount(records),
    loading,
    online: profiles.some((profile) => profile.status === "online"),
    markAllRead,
    markRead,
    refresh,
  };
}

export function AlertCenterProvider({ children }: { children: ReactNode }) {
  return (
    <AlertCenterContext.Provider value={useAlertCenterStore()}>
      {children}
    </AlertCenterContext.Provider>
  );
}

export function useAlertCenter(): AlertCenterValue {
  const context = useContext(AlertCenterContext);
  if (!context) throw new Error("useAlertCenter must be used within AlertCenterProvider");
  return context;
}
