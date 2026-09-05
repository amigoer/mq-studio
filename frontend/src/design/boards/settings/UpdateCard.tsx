import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  CircleSlash,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MeterRow,
  Panel,
  SectionLabel,
} from "@/components";
import { Markdown } from "@/components/markdown";
import { Blocker, Phase, Policy, updateProgress } from "@/api/updates";
import { useUpdater } from "@/hooks/useUpdater";
import { useSettings } from "@/hooks/useSettings";
import {
  blockerKey,
  errorText,
  formatBytes,
  formatDate,
  formatDateTime,
  updateLocale,
} from "@/lib/updateText";

/**
 * The whole of the update flow, in the one place people look for it.
 *
 * Nothing about it is on the canvas: the design was drawn before there was
 * anything to update, so this is an addition. It follows the settings language
 * the rest of the page uses -- a `Card`, a `SectionLabel`, `.btn3` actions --
 * and reports every phase the Go manager can be in rather than only the two
 * the old toast could say.
 */

function Headline({ icon, tone, title, meta }: {
  icon: typeof CheckCircle2;
  tone: string;
  title: string;
  meta?: string;
}) {
  const Icon = icon;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", minWidth: 0, flex: 1 }}>
      <Icon size={15} color={tone} style={{ flex: "none", marginTop: "2px" }} aria-hidden />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--set-label)", fontWeight: 500 }}>{title}</div>
        {meta != null && meta !== "" && (
          <div style={{ fontSize: "var(--set-hint)", color: "var(--c-muted)", marginTop: "3px" }}>
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

export function UpdateCard() {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const { state, available, busy, check, download, cancel, install, skip, openDownloads } =
    useUpdater();
  const locale = updateLocale(i18n.language);
  const blocked = blockerKey(state.location?.blocker ?? Blocker.BlockerNone);
  const checkedAt = formatDateTime(state.checkedAt, locale);

  return (
    <Panel style={{ padding: "16px 18px" }}>
      <SectionLabel style={{ marginBottom: "12px" }}>{t("update.section")}</SectionLabel>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        {renderHeadline()}
        <div style={{ display: "flex", gap: "8px", flex: "none" }}>{renderActions()}</div>
      </div>
      {available != null && state.notes !== "" && (
        <div className="mt-3 max-h-[168px] overflow-y-auto rounded-lg border border-(--c-border) bg-(--c-bar) px-3 py-2.5">
          <Markdown source={state.notes} />
        </div>
      )}
      {renderFooter()}
    </Panel>
  );

  function renderHeadline() {
    switch (state.phase) {
      case Phase.PhaseChecking:
        return <Headline icon={RefreshCw} tone="var(--c-fg-2)" title={t("update.checking")} />;
      case Phase.PhaseDownloading:
        return (
          <Headline
            icon={ArrowDownToLine}
            tone="var(--c-fg-2)"
            title={t("update.downloading", { version: state.latestVersion })}
          />
        );
      case Phase.PhaseReady:
        return (
          <Headline
            icon={CheckCircle2}
            tone="var(--c-ok-text)"
            title={t("update.readyTitle", { version: state.latestVersion })}
            meta={
              settings.updatePolicy === Policy.PolicyAuto
                ? t("update.readyOnQuit")
                : t("update.readyHint")
            }
          />
        );
      case Phase.PhaseInstalling:
        return <Headline icon={RotateCw} tone="var(--c-fg-2)" title={t("update.installing")} />;
      case Phase.PhaseError:
        return (
          <Headline
            icon={AlertCircle}
            tone="var(--c-err-text)"
            title={t(`update.failed.${state.failedStep || "check"}`)}
            meta={errorText(state.error, t)}
          />
        );
      case Phase.PhaseAvailable:
        /* A skipped release is still the newest one, so the phase does not
           change when it is declined -- only whether there is anything to
           offer. Announcing it anyway left the card saying a version was
           found beside a button offering to look for one. */
        if (available == null) {
          return (
            <Headline
              icon={CircleSlash}
              tone="var(--c-muted)"
              title={t("update.skippedTitle", { version: state.latestVersion })}
              meta={t("update.skippedHint")}
            />
          );
        }
        return (
          <Headline
            icon={Download}
            tone="var(--c-ok-text)"
            title={t("update.availableTitle", { version: state.latestVersion })}
            meta={[
              formatDate(state.publishedAt, locale),
              t("update.currentIs", { version: state.currentVersion || "—" }),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      default:
        // Claiming "you are up to date" for a version that was never released
        // would be worse than saying nothing at all.
        if (state.development) {
          return (
            <Headline
              icon={AlertCircle}
              tone="var(--c-muted)"
              title={t("update.developmentBuild")}
              meta={t("update.developmentHint")}
            />
          );
        }
        return (
          <Headline
            icon={CheckCircle2}
            tone="var(--c-ok-text)"
            title={t("update.upToDate", { version: state.currentVersion || "—" })}
            meta={checkedAt === "" ? t("update.neverChecked") : t("update.lastChecked", { at: checkedAt })}
          />
        );
    }
  }

  function renderActions() {
    /* A failure always leaves a way out. The site's download page is the one
       that works even when whatever the app tried does not -- a release with no
       checksum list, a disk image that will not mount, a download that keeps
       failing. */
    if (state.phase === Phase.PhaseError) {
      return (
        <>
          <Button variant="outline" onClick={openDownloads}>
            <ExternalLink size={13} aria-hidden />
            {t("page.settings.about.openDownloads")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => void (available != null && blocked == null ? download() : check())}
          >
            <RefreshCw size={13} aria-hidden />
            {t("update.retry")}
          </Button>
        </>
      );
    }
    if (state.phase === Phase.PhaseDownloading) {
      return (
        <Button variant="outline" onClick={cancel}>
          <X size={13} aria-hidden />
          {t("update.cancel")}
        </Button>
      );
    }
    if (state.phase === Phase.PhaseReady) {
      return (
        <Button onClick={() => void install()}>
          <RotateCw size={13} aria-hidden />
          {t("update.installNow")}
        </Button>
      );
    }
    if (available != null) {
      return (
        <>
          <Button variant="outline" onClick={skip} disabled={busy}>
            {t("update.skip")}
          </Button>
          {blocked == null ? (
            <Button onClick={() => void download()} disabled={busy}>
              <Download size={13} aria-hidden />
              {t("update.download")}
            </Button>
          ) : (
            <Button onClick={openDownloads}>
              <ExternalLink size={13} aria-hidden />
              {t("page.settings.about.openDownloads")}
            </Button>
          )}
        </>
      );
    }
    return (
      <Button disabled={busy || state.development} onClick={() => void check()}>
        <RefreshCw size={13} aria-hidden />
        {busy ? t("page.settings.about.checking") : t("page.settings.about.checkUpdate")}
      </Button>
    );
  }

  function renderFooter() {
    if (state.phase === Phase.PhaseDownloading) {
      const fraction = updateProgress(state);
      return (
        <div style={{ marginTop: "14px" }}>
          <MeterRow
            label={state.latestVersion}
            /* An unknown length draws a full bar rather than a jumping one;
               the byte count beside it is what actually moves. */
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
    if (blocked != null && available != null) {
      return (
        <div
          style={{
            marginTop: "12px",
            fontSize: "var(--set-hint)",
            color: "var(--c-warn-text-deep)",
            background: "var(--c-warn-bg-soft)",
            border: "1px solid var(--c-warn-border)",
            borderRadius: "8px",
            padding: "8px 10px",
          }}
        >
          {t(blocked)}
        </div>
      );
    }
    return null;
  }
}
