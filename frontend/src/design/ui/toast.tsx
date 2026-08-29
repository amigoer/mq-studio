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
import { AlertCircle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Btn } from "./button";

/**
 * Transient feedback for the actions the settings page fires -- saving
 * credentials, exporting a config, checking for an update. The canvas draws no
 * transient state at all, so this and the confirm dialog beside it are the two
 * additions the wiring needed. Both are built from `.card3` and the `.st` tones
 * so they read as part of the drawn set.
 */

export type ToastTone = "success" | "error" | "info";

export type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds on screen; 0 stays until dismissed. */
  duration?: number;
};

type Toast = ToastOptions & { id: number; tone: ToastTone; message: string };

/** Long enough to read the line; a failure earns the time to act on it. */
const DURATION: Record<ToastTone, number> = { success: 4000, info: 4500, error: 7000 };

const TONE: Record<ToastTone, { icon: LucideIcon; colour: string }> = {
  success: { icon: CheckCircle2, colour: "var(--c-ok-text)" },
  error: { icon: AlertCircle, colour: "var(--c-err-text)" },
  info: { icon: Info, colour: "var(--c-fg-2)" },
};

/** Older toasts leave rather than push the stack past the corner. */
const MAX_VISIBLE = 3;

type Show = (message: string, options?: ToastOptions) => void;

type ToastContextValue = { success: Show; error: Show; info: Show };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => {
    const push =
      (tone: ToastTone): Show =>
      (message, options) => {
        const id = nextId.current++;
        setToasts((current) => [
          ...current.slice(-(MAX_VISIBLE - 1)),
          { ...options, id, tone, message },
        ]);
      };
    return { success: push("success"), error: push("error"), info: push("info") };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toastw" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  const { t } = useTranslation();
  const { id, tone, message, description, action } = toast;
  const duration = toast.duration ?? DURATION[tone];
  const { icon: Icon, colour } = TONE[tone];

  useEffect(() => {
    if (duration <= 0) return;
    const timer = window.setTimeout(() => dismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, duration, id]);

  return (
    <div className="card3 toast3">
      <Icon size={15} color={colour} style={{ flex: "none", marginTop: "1px" }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12.5px", lineHeight: 1.45 }}>{message}</div>
        {description != null && (
          <div style={{ fontSize: "11px", color: "var(--c-muted)", marginTop: "3px", lineHeight: 1.5 }}>
            {description}
          </div>
        )}
        {action != null && (
          <Btn
            style={{ marginTop: "9px" }}
            onClick={() => {
              action.onClick();
              dismiss(id);
            }}
          >
            {action.label}
          </Btn>
        )}
      </div>
      <button
        type="button"
        aria-label={t("common.dismiss")}
        onClick={() => dismiss(id)}
        style={{
          display: "flex",
          flex: "none",
          color: "var(--c-muted-2)",
          background: "none",
          border: "none",
          padding: 0,
        }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context == null) throw new Error("useToast must be used within ToastProvider");
  return context;
}
