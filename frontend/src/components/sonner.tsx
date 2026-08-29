import { useSyncExternalStore, type CSSProperties } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * shadcn/ui's sonner Toaster, dressed in the canvas instead of in shadcn's own
 * tokens: the `--normal-*` variables below are what `.card3` paints with, and
 * the rest of the surface is styled in tokens.css under `.mqs-toaster`. What
 * the component brings that the hand-drawn stack did not is the behaviour --
 * a collapsed stack that expands on hover, swipe to dismiss, pause on hover,
 * and the focus hotkey.
 *
 * shadcn reads the theme from next-themes; here it is the `dark` class that
 * lib/theme puts on the document. The Toaster mounts above the settings store,
 * so it watches the attribute rather than subscribing to the store.
 */

function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

export function Toaster(props: ToasterProps) {
  const { t } = useTranslation();
  const dark = useSyncExternalStore(subscribeToTheme, isDark, () => false);

  return (
    <Sonner
      className="mqs-toaster"
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      offset={16}
      gap={8}
      visibleToasts={3}
      closeButton
      toastOptions={{ closeButtonAriaLabel: t("common.dismiss") }}
      icons={{
        success: <CheckCircle2 size={15} />,
        info: <Info size={15} />,
        warning: <TriangleAlert size={15} />,
        error: <AlertCircle size={15} />,
      }}
      style={
        {
          "--normal-bg": "var(--c-bg)",
          "--normal-text": "var(--c-fg)",
          "--normal-border": "var(--c-border)",
          "--border-radius": "12px",
          "--width": "340px",
          "--toast-close-button-start": "unset",
          "--toast-close-button-end": "0",
          "--toast-close-button-transform": "translate(35%, -35%)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
