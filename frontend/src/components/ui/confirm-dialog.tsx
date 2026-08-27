import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      role="alertdialog"
      size="sm"
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          {/* Cancel takes initial focus: the safer default for a destructive prompt. */}
          <Button
            variant="outline"
            size="sm"
            type="button"
            data-autofocus
            onClick={onCancel}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            size="sm"
            type="button"
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </>
      }
    />
  );
}
