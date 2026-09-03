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
import { useTranslation } from "react-i18next";
import { useToast, type ToastId } from "@/components";
import { openExternal } from "@/api/platform";
import { formatErrorMessage } from "@/lib/utils";
import {
  cancelUpdate,
  checkUpdate,
  downloadUpdate,
  hasUpdate,
  installUpdate,
  isUpdateBusy,
  onUpdateState,
  Phase,
  Policy,
  skipUpdate,
  Status,
  UNKNOWN_UPDATE_STATE,
  updateState,
  type UpdateState,
} from "@/api/updates";

/**
 * The renderer's half of the update lifecycle.
 *
 * Go owns the state machine, the schedule and the verified package; this reads
 * what it publishes and forwards the buttons. The one thing decided here is
 * when to speak: a release is announced once a session, and a check the user
 * asked for reports every outcome including "you are already on the latest".
 */

// Every way out of the updater points at the site rather than at GitHub: it
// carries the same packages and the same notes, and it is reachable on networks
// that cannot open github.com.
const SITE_URL = "https://mq-studio.amigoer.com";

/** zh is the site's default locale and stays unprefixed; en lives under /en/. */
function sitePath(language: string, path: string): string {
  return `${SITE_URL}${language.startsWith("en") ? "/en" : ""}${path}`;
}

interface UpdaterContextValue {
  state: UpdateState;
  /** The pending release, or null when there is nothing to offer. */
  available: string | null;
  /** True while a check, download or install is in flight. */
  busy: boolean;
  /** True while a check alone is in flight -- what the title bar icon turns on. */
  checking: boolean;
  /** Whether the update dialog is up. It is shell state, so it lives here
      rather than in a board: the title bar and the toast both open it. */
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  cancel: () => void;
  install: () => Promise<void>;
  skip: () => void;
  /** Opens the site's download section -- the way through when the app cannot
      install the release itself. */
  openDownloads: () => void;
  /** Opens the site's changelog, for notes the dialog cannot render. */
  openNotes: () => void;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

function useUpdaterState(): UpdaterContextValue {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<UpdateState>(UNKNOWN_UPDATE_STATE);
  // A check the user is waiting on. Go publishes PhaseChecking too, but this
  // covers the call from the click to that event and the checks Go answers
  // without ever entering the phase, such as on a development build.
  const [checking, setChecking] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The release this session has already put in front of the user.
  //
  // Session memory on purpose. Go used to persist this, so a version was
  // announced exactly once in its lifetime -- miss the toast and the only
  // remaining notice was a six-pixel dot on the title bar. Now it comes back on
  // the next launch, and the only way to stop it for good is to skip it.
  const announced = useRef("");
  // The standing announcement, so it can be taken down once it is answered. A
  // toast that never leaves is worse than one that fades too soon.
  const announcement = useRef<ToastId | null>(null);
  // The background check reports on its own timetable, so the toast text has
  // to be reachable without re-subscribing every time the language changes.
  const translate = useRef(t);
  translate.current = t;

  const dismissAnnouncement = useCallback(() => {
    if (announcement.current == null) return;
    toast.dismiss(announcement.current);
    announcement.current = null;
  }, [toast]);

  // Opening the dialog is the answer the toast was asking for.
  const openDialog = useCallback(() => {
    dismissAnnouncement();
    setDialogOpen(true);
  }, [dismissAnnouncement]);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const openDownloads = useCallback(() => {
    void openExternal(sitePath(i18n.language, "/#download")).catch(() => {});
  }, [i18n.language]);

  const openNotes = useCallback(() => {
    void openExternal(sitePath(i18n.language, "/changelog/")).catch(() => {});
  }, [i18n.language]);

  /* Announcing is the only thing the renderer decides. It happens on whatever
     state arrives -- the first read, a background check, a finished download --
     because any of them can be the first to carry a release. */
  const announce = useCallback(
    (next: UpdateState) => {
      if (!hasUpdate(next) || next.latestVersion === announced.current) return;
      announced.current = next.latestVersion;
      const version = next.latestVersion;
      const ready = next.phase === Phase.PhaseReady;
      announcement.current = toast.info(
        translate.current(ready ? "update.readyTitle" : "update.availableTitle", { version }),
        {
          description: translate.current(ready ? "update.readyHint" : "update.availableHint"),
          // Stays until it is answered. A pending update is a state rather than
          // a passing event, and the notice that carries it should outlast the
          // four seconds the reader might be looking elsewhere.
          duration: 0,
          action: {
            label: translate.current(ready ? "update.installNow" : "update.updateNow"),
            onClick: () => {
              if (ready) void installUpdate().catch(() => {});
              else openDialog();
            },
          },
        },
      );
    },
    [openDialog, toast],
  );

  /* Taken, skipped or overtaken: whatever the answer was, the standing toast
     has stopped being true and must not outlive it. */
  useEffect(() => {
    if (!hasUpdate(state)) dismissAnnouncement();
  }, [dismissAnnouncement, state]);

  useEffect(() => {
    let cancelled = false;
    void updateState()
      .then((current) => {
        if (cancelled) return;
        setState(current);
        announce(current);
      })
      .catch(() => {
        // Go is unreachable, which in a browser preview is the normal case.
        // The panel then shows what it can and the buttons report their own
        // failures.
      });
    const off = onUpdateState((next) => {
      setState(next);
      announce(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [announce]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const next = await checkUpdate();
      setState(next);
      if (next.outcome === Status.StatusAhead) {
        toast.info(
          t("page.settings.about.aheadOfRelease", {
            current: next.currentVersion,
            latest: next.latestVersion || next.currentVersion,
          }),
        );
        return;
      }
      if (!hasUpdate(next)) {
        toast.success(t("page.settings.about.upToDate", { version: next.currentVersion }));
        return;
      }
      // The user pressed the button and is waiting on the answer, so the
      // release itself is the answer: the dialog opens rather than a toast
      // reporting that one exists and leaving the install somewhere else.
      announced.current = next.latestVersion;
      openDialog();
    } catch (error) {
      toast.error(t("page.settings.about.updateCheckFailed"), {
        description: formatErrorMessage(error),
        action: { label: t("page.settings.about.openDownloads"), onClick: openDownloads },
      });
    } finally {
      setChecking(false);
    }
  }, [openDialog, openDownloads, t, toast]);

  const download = useCallback(async () => {
    try {
      await downloadUpdate();
    } catch (error) {
      toast.error(t("update.downloadFailed"), { description: formatErrorMessage(error) });
    }
  }, [t, toast]);

  const install = useCallback(async () => {
    try {
      await installUpdate();
    } catch (error) {
      toast.error(t("update.installFailed"), {
        description: formatErrorMessage(error),
        action: { label: t("page.settings.about.openDownloads"), onClick: openDownloads },
      });
    }
  }, [openDownloads, t, toast]);

  const cancel = useCallback(() => void cancelUpdate().catch(() => {}), []);

  const skip = useCallback(() => {
    const version = state.latestVersion;
    if (!version) return;
    void skipUpdate(version).catch(() => {});
    setState((current) => ({ ...current, skipped: version }) as UpdateState);
  }, [state.latestVersion]);

  return useMemo(
    () => ({
      state,
      available: hasUpdate(state) ? state.latestVersion : null,
      busy: checking || isUpdateBusy(state),
      checking: checking || state.phase === Phase.PhaseChecking,
      dialogOpen,
      openDialog,
      closeDialog,
      check,
      download,
      cancel,
      install,
      skip,
      openDownloads,
      openNotes,
    }),
    [
      cancel,
      check,
      checking,
      closeDialog,
      dialogOpen,
      download,
      install,
      openDialog,
      openDownloads,
      openNotes,
      skip,
      state,
    ],
  );
}

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const value = useUpdaterState();
  return createElement(UpdaterContext.Provider, { value }, children);
}

/** Reads the shared update state. Must be called within UpdaterProvider. */
export function useUpdater(): UpdaterContextValue {
  const context = useContext(UpdaterContext);
  if (context == null) throw new Error("useUpdater must be used within UpdaterProvider");
  return context;
}

/** The policy ladder, for the settings row that sets it. */
export const UPDATE_POLICY_ORDER = [
  Policy.PolicyOff,
  Policy.PolicyNotify,
  Policy.PolicyDownload,
  Policy.PolicyAuto,
] as const;
