import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "./button";
import { Dialog } from "./dialog";

/**
 * The question asked before an action that cannot be taken back: clearing the
 * cache, restoring defaults, importing over the current config. Nothing in the
 * canvas draws one, so it is the drawn modal (3a) with a fixed footer.
 *
 * It sits above `.m3` rather than inside it, so the scrim covers the title bar
 * too: switching tabs with the question still open would strand it.
 */

export type ConfirmRequest = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Draws the confirming button as destructive. */
  danger?: boolean;
};

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setRequest(null);
  }, []);

  const confirm = useCallback<Confirm>((next) => {
    // A second question while one is open would strand the first caller's
    // promise, so the one being replaced answers no.
    resolveRef.current?.(false);
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request != null}
        title={request?.title ?? ""}
        width={440}
        onClose={() => settle(false)}
        footer={
          <>
            <span style={{ flex: 1 }} />
            <Btn onClick={() => settle(false)}>{request?.cancelLabel ?? t("common.cancel")}</Btn>
            <Btn
              autoFocus
              variant={request?.danger === true ? "danger" : "primary"}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? t("common.confirm")}
            </Btn>
          </>
        }
      >
        {request?.description != null && (
          <div style={{ fontSize: "12.5px", color: "var(--c-fg-2)", lineHeight: 1.6 }}>
            {request.description}
          </div>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (confirm == null) throw new Error("useConfirm must be used within ConfirmProvider");
  return confirm;
}
