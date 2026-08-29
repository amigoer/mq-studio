import { toast as sonner } from "sonner";

/**
 * Transient feedback for the actions the settings page fires -- saving
 * credentials, exporting a config, checking for an update. The canvas draws no
 * transient state at all, so this and the confirm dialog beside it are the two
 * additions the wiring needed.
 *
 * The stack itself is shadcn/ui's sonner, mounted as `<Toaster />` in main.tsx.
 * What is left here is the tone-and-duration policy on top of it, kept behind a
 * hook so the boards read the same as they did before the swap.
 */

export type ToastTone = "success" | "error" | "info";

export type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen; 0 stays until dismissed. */
  duration?: number;
};

/** Long enough to read the line; a failure earns the time to act on it. */
const TIME_ON_SCREEN: Record<ToastTone, number> = { success: 4000, info: 4500, error: 7000 };

type Show = (message: string, options?: ToastOptions) => void;

function show(tone: ToastTone): Show {
  return (message, options = {}) => {
    const { description, action, duration = TIME_ON_SCREEN[tone] } = options;
    sonner[tone](message, {
      description,
      action,
      duration: duration <= 0 ? Number.POSITIVE_INFINITY : duration,
    });
  };
}

export const toast = {
  success: show("success"),
  error: show("error"),
  info: show("info"),
} as const;

export type ToastApi = typeof toast;

/** The stack is global; the hook is what the boards already call. */
export function useToast(): ToastApi {
  return toast;
}
