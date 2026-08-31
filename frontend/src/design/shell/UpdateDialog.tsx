import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  CircleFadingArrowUp,
  Download,
  ExternalLink,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown, MeterRow } from "@/components";
import { Blocker, Phase, Policy, updateProgress } from "@/api/updates";
import { useUpdater } from "@/hooks/useUpdater";
import { useSettings } from "@/hooks/useSettings";
import { blockerKey, formatBytes, formatDate, updateLocale } from "@/lib/updateText";

/**
 * The update, offered where it is announced.
 *
 * Before this, finding out about a release and acting on it were two different
 * places: a toast said a version existed and sent the reader to a browser, and
 * the only button that installed anything lived inside the settings page. This
 * is the surface that closes that gap -- what changed, and the button that
 * takes it, in one place reachable from the title bar and from the toast.
 *
 * It lives in the shell rather than beside the settings card because it belongs
 * to the window: the card is one board among many, and this opens over any of
 * them.
 */

export function UpdateDialog() {
  const { dialogOpen, closeDialog } = useUpdater();
  return (
    <Dialog open={dialogOpen} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]" showCloseButton={false}>
        <UpdatePanel />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's contents, separated from the overlay that carries them.
 *
 * `DialogContent` renders through a portal, which server rendering cannot
 * follow -- so this is what the test mounts, under a bare `Dialog` root that
 * supplies the title's context without portalling anything.
 */
export function UpdatePanel() {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const {
    state,
    available,
    busy,
    closeDialog,
    download,
    cancel,
    install,
    skip,
    check,
    openReleases,
  } = useUpdater();

  const locale = updateLocale(i18n.language);
  const blocked = blockerKey(state.location?.blocker ?? Blocker.BlockerNone);
  const published = formatDate(state.publishedAt, locale);

  const headline = () => {
    switch (state.phase) {
      case Phase.PhaseDownloading:
        return {
          icon: ArrowDownToLine,
          tone: "text-(--c-fg-2)",
          title: t("update.downloading", { version: state.latestVersion }),
        };
      case Phase.PhaseReady:
        return {
          icon: CheckCircle2,
          tone: "text-(--c-ok-text)",
          title: t("update.readyTitle", { version: state.latestVersion }),
        };
      case Phase.PhaseInstalling:
        return { icon: RotateCw, tone: "text-(--c-fg-2)", title: t("update.installing") };
      case Phase.PhaseError:
        return {
          icon: AlertCircle,
          tone: "text-(--c-err-text)",
          title: t(`update.failed.${state.failedStep || "check"}`),
        };
      default:
        return {
          icon: CircleFadingArrowUp,
          tone: "text-(--c-ok-text)",
          title: t("update.availableTitle", { version: state.latestVersion }),
        };
    }
  };

  /* The meta line under the title. A failure replaces it with its own reason:
     what went wrong matters more here than when the release was published. */
  const meta = () => {
    if (state.phase === Phase.PhaseError) return state.error;
    if (state.phase === Phase.PhaseReady) {
      return settings.updatePolicy === Policy.PolicyAuto
        ? t("update.readyOnQuit")
        : t("update.readyHint");
    }
    return [published, t("update.currentIs", { version: state.currentVersion || "—" })]
      .filter(Boolean)
      .join(" · ");
  };

  const { icon: Icon, tone, title } = headline();

  return (
    <>
      <DialogHeader className="border-b border-(--c-border) px-[18px] pt-4 pb-3">
        <div className="flex items-start gap-2.5">
          <Icon size={18} className={`mt-0.5 flex-none ${tone}`} aria-hidden />
          <div className="min-w-0">
            <DialogTitle className="text-[15px] font-medium">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[12px] text-(--c-muted)">
              {meta()}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {state.notes !== "" && state.phase !== Phase.PhaseInstalling && (
        <div className="max-h-[320px] overflow-y-auto px-[18px] pt-3.5 pb-1">
          <Markdown source={state.notes} />
        </div>
      )}

      {state.phase === Phase.PhaseDownloading && renderProgress()}

      {blocked != null && available != null && (
        <div className="mx-[18px] mb-1 rounded-lg border border-(--c-warn-border) bg-(--c-warn-bg-soft) px-2.5 py-2 text-[12px] text-(--c-warn-text-deep)">
          {t(blocked)}
        </div>
      )}

      <DialogFooter className="items-center border-t border-(--c-border) bg-(--c-bar) px-[18px] py-3 sm:justify-start">
        {/* Always reachable: if the notes render poorly, or the app cannot
            replace itself, the release page is the way through. */}
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-(--c-muted)"
          onClick={openReleases}
        >
          <ExternalLink size={13} aria-hidden />
          {t("update.viewOnGithub")}
        </Button>
        <span className="flex-1" />
        {renderActions()}
      </DialogFooter>
    </>
  );

  function renderProgress() {
    const fraction = updateProgress(state);
    return (
      <div className="px-[18px] py-3.5">
        <MeterRow
          label={state.latestVersion}
          /* An unknown length draws a full bar rather than a jumping one; the
             byte count beside it is what actually moves. */
          value={fraction == null ? 100 : Math.round(fraction * 100)}
          display={
            fraction == null
              ? formatBytes(state.downloaded)
              : `${formatBytes(state.downloaded)} / ${formatBytes(state.total)}`
          }
          color="var(--c-ok)"
        />
      </div>
    );
  }

  function renderActions() {
    if (state.phase === Phase.PhaseInstalling) return null;

    if (state.phase === Phase.PhaseDownloading) {
      return (
        <Button variant="outline" size="sm" onClick={cancel}>
          <X size={13} aria-hidden />
          {t("update.cancel")}
        </Button>
      );
    }

    if (state.phase === Phase.PhaseError) {
      return (
        <>
          <Button variant="outline" size="sm" onClick={closeDialog}>
            {t("update.later")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void (available != null && blocked == null ? download() : check())}
          >
            {t("update.retry")}
          </Button>
        </>
      );
    }

    if (state.phase === Phase.PhaseReady) {
      return (
        <>
          <Button variant="outline" size="sm" onClick={closeDialog}>
            {t("update.later")}
          </Button>
          <Button size="sm" onClick={() => void install()}>
            <RotateCw size={13} aria-hidden />
            {t("update.installNow")}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-(--c-muted)"
          disabled={busy}
          onClick={() => {
            skip();
            closeDialog();
          }}
        >
          {t("update.skip")}
        </Button>
        <Button variant="outline" size="sm" onClick={closeDialog}>
          {t("update.later")}
        </Button>
        {blocked == null ? (
          <Button size="sm" disabled={busy} onClick={() => void download()}>
            <Download size={13} aria-hidden />
            {t("update.download")}
          </Button>
        ) : (
          <Button size="sm" onClick={openReleases}>
            <ExternalLink size={13} aria-hidden />
            {t("page.settings.about.openReleases")}
          </Button>
        )}
      </>
    );
  }
}
