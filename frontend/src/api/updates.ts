/**
 * The update lifecycle, as the renderer sees it.
 *
 * Nothing here decides anything. When to check, whether to download and whether
 * to install are the Go manager's calls -- it holds the policy, the schedule and
 * the verified package, and it is the only thing that survives the window being
 * closed to the tray. This module reads its state and forwards the buttons.
 */
import { Events } from "@wailsio/runtime";
import { UpdateService } from "@bindings/bridge";
import { Blocker, FailedStep, Kind, Phase, Policy, State, Status } from "@bindings/update/models";

export { Blocker, FailedStep, Kind, Phase, Policy, Status };
export type UpdateState = State;

/** The rungs of the policy ladder, in the order the settings row offers them. */
export const UPDATE_POLICIES = [
  Policy.PolicyOff,
  Policy.PolicyNotify,
  Policy.PolicyDownload,
  Policy.PolicyAuto,
] as const;

/** The state to draw before Go has answered, and if it never does. */
export const UNKNOWN_UPDATE_STATE: UpdateState = State.createFrom({
  phase: Phase.PhaseIdle,
  policy: Policy.PolicyNotify,
  currentVersion: "",
  latestVersion: "",
  total: -1,
});

/** Narrows an arbitrary string onto the ladder. */
export const isPolicy = (value: unknown): value is Policy =>
  UPDATE_POLICIES.some((policy) => policy === value);

export const updateState = (): Promise<UpdateState> => UpdateService.State();

/** Checks now, whatever the policy says. Only a button press calls this. */
export const checkUpdate = (): Promise<UpdateState> => UpdateService.Check();

export const downloadUpdate = (): Promise<void> => UpdateService.Download();
export const cancelUpdate = (): Promise<void> => UpdateService.Cancel();
export const installUpdate = (): Promise<void> => UpdateService.Install();
export const skipUpdate = (version: string): Promise<void> => UpdateService.Skip(version);
export const markUpdateAnnounced = (version: string): Promise<void> =>
  UpdateService.MarkAnnounced(version);
export const announcedUpdate = (): Promise<string> => UpdateService.Announced();

/**
 * Subscribes to the manager publishing a new state. Keep the name in step with
 * update.Event.
 */
export function onUpdateState(listener: (state: UpdateState) => void): () => void {
  return Events.On("update:state", (event) => {
    const data = event.data as UpdateState | undefined;
    if (data != null && typeof data === "object" && "phase" in data) listener(data);
  });
}

/** True while the app is doing something the user should not start twice. */
export const isUpdateBusy = (state: UpdateState): boolean =>
  state.phase === Phase.PhaseChecking ||
  state.phase === Phase.PhaseDownloading ||
  state.phase === Phase.PhaseInstalling;

/** A release worth putting in front of the user: newer, and not one they skipped. */
export const hasUpdate = (state: UpdateState): boolean =>
  state.latestVersion !== "" && state.latestVersion !== state.skipped;

/** Download progress as a fraction, or null while the length is unknown. */
export function updateProgress(state: UpdateState): number | null {
  if (state.total <= 0) return null;
  return Math.min(1, state.downloaded / state.total);
}
