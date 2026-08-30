/**
 * Desktop notification delivery, behind one seam.
 *
 * Native first, through Wails' own notifications service, because the renderer
 * runs in a WKWebView where the Web Notification API is usually absent -- and
 * where, when it is present, it is not what macOS shows in Notification Centre.
 *
 * The Web API stays as the fallback for one real case: Wails only delivers
 * from a packaged, signed bundle, so `wails3 task dev` and the plain Vite
 * preview would otherwise be silent.
 *
 * Callers get a boolean rather than an exception. A banner that could not be
 * shown is not a failure worth surfacing -- the alert is already in the bell.
 */
import { NotificationService as native } from "@wails/services/notifications";

export interface DesktopNotification {
  title: string;
  body: string;
  /** Collapses repeats of the same alert into one banner. */
  tag: string;
}

function webApiPresent(): boolean {
  return typeof Notification !== "undefined";
}

/**
 * Asks for permission, once, through whichever channel answers.
 *
 * Called when the user turns the setting on rather than at launch: a prompt
 * nobody asked for is the kind of thing that gets denied for good.
 */
export async function requestDesktopNotifyPermission(): Promise<boolean> {
  try {
    if (await native.RequestNotificationAuthorization()) return true;
  } catch {
    // Not running under Wails, or the service is unavailable on this host.
  }
  if (!webApiPresent()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Whether anything would actually be shown, without prompting for it. */
export async function desktopNotifyAuthorized(): Promise<boolean> {
  try {
    if (await native.CheckNotificationAuthorization()) return true;
  } catch {
    // Fall through to the Web API.
  }
  return webApiPresent() && Notification.permission === "granted";
}

export async function sendDesktopNotification(
  notification: DesktopNotification,
): Promise<boolean> {
  try {
    await native.SendNotification({
      // The tag doubles as the id, so a re-fire replaces its own banner rather
      // than stacking a second one behind it.
      id: notification.tag,
      title: notification.title,
      body: notification.body,
    });
    return true;
  } catch {
    // Unpackaged dev build, or no Wails host: try the browser's own.
  }
  if (!webApiPresent() || Notification.permission !== "granted") return false;
  try {
    new Notification(notification.title, {
      body: notification.body,
      tag: notification.tag,
    });
    return true;
  } catch {
    // Some WebView builds expose the constructor and then reject it.
    return false;
  }
}
