import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

/**
 * The question asked before an action that cannot be taken back: clearing the
 * cache, restoring defaults, redelivering a dead letter. One provider, asked
 * imperatively, so call sites read as `if (await confirm({...}))`.
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
      <AlertDialog
        open={request != null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{request?.title}</AlertDialogTitle>
            {request?.description != null && (
              <AlertDialogDescription>{request.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {request?.cancelLabel ?? t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              autoFocus
              className={
                request?.danger === true ? buttonVariants({ variant: "destructive" }) : undefined
              }
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (confirm == null) throw new Error("useConfirm must be used within ConfirmProvider");
  return confirm;
}
