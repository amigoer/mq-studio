import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCw,
  X,
} from "lucide-react";
import { Btn, Card, MeterRow, SectionLabel } from "@/design/ui";
import { Blocker, Phase, Policy, updateProgress } from "@/api/updates";
import { useUpdater } from "@/hooks/useUpdater";
import { useSettings } from "@/hooks/useSettings";

/**
 * The whole of the update flow, in the one place people look for it.
 *
 * Nothing about it is on the canvas: the design was drawn before there was
 * anything to update, so this is an addition. It follows the settings language
 * the rest of the page uses -- a `Card`, a `SectionLabel`, `.btn3` actions --
 * and reports every phase the Go manager can be in rather than only the two
 * the old toast could say.
 */

/** Bytes as the download line shows them: one decimal, MB above a megabyte. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A date the release carries, in the reader's own locale, or "" if unparsable. */
function formatDate(value: string, locale: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value: string, locale: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Release notes come out of the changelog as Markdown. Rather than pull in a
 * renderer for the three shapes they actually use, headings and bullets are
 * drawn here and anything else is left as a paragraph.
 */
function Notes({ notes }: { notes: string }) {
  const lines = notes.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  return (
    <div
      style={{
        marginTop: "12px",
        padding: "10px 12px",
        maxHeight: "168px",
        overflowY: "auto",
        border: "1px solid var(--c-border)",
        borderRadius: "8px",
        background: "var(--c-bar)",
        fontSize: "11.5px",
        lineHeight: 1.65,
      }}
    >
      {lines.map((line, index) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading != null) {
          return (
            <div
              key={index}
              style={{
                fontWeight: 600,
                color: "var(--c-fg)",
                marginTop: index === 0 ? 0 : "8px",
                marginBottom: "2px",
              }}
            >
              {heading[1]}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet != null) {
          return (
            <div key={index} style={{ display: "flex", gap: "7px", color: "var(--c-fg-2)" }}>
              <span style={{ color: "var(--c-muted-2)" }}>·</span>
              <span style={{ minWidth: 0 }}>{bullet[1]}</span>
            </div>
          );
        }
        return (
          <div key={index} style={{ color: "var(--c-fg-2)" }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

/** Why the app cannot replace itself here, said in the reader's terms. */
function blockerKey(blocker: Blocker): string | null {
  switch (blocker) {
    case Blocker.BlockerPackageManager:
      return "update.blocked.packageManager";
    case Blocker.BlockerReadOnly:
      return "update.blocked.readOnly";
    case Blocker.BlockerNotPackaged:
      return "update.blocked.notPackaged";
    case Blocker.BlockerUnsupported:
      return "update.blocked.unsupported";
    default:
      return null;
  }
}

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
  const { state, available, busy, check, download, cancel, install, skip, openReleases } =
    useUpdater();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const blocked = blockerKey(state.location?.blocker ?? Blocker.BlockerNone);
  const checkedAt = formatDateTime(state.checkedAt, locale);

  return (
    <Card style={{ padding: "16px 18px" }}>
      <SectionLabel style={{ marginBottom: "12px" }}>{t("update.section")}</SectionLabel>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        {renderHeadline()}
        <div style={{ display: "flex", gap: "8px", flex: "none" }}>{renderActions()}</div>
      </div>
      {available != null && state.notes !== "" && <Notes notes={state.notes} />}
      {renderFooter()}
    </Card>
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
            meta={state.error}
          />
        );
      case Phase.PhaseAvailable:
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
    /* A failure always leaves a way out. Releases is the one that works even
       when whatever the app tried does not -- a release with no checksum list,
       a disk image that will not mount, a download that keeps failing. */
    if (state.phase === Phase.PhaseError) {
      return (
        <>
          <Btn onClick={openReleases}>
            <ExternalLink size={13} aria-hidden />
            {t("page.settings.about.openReleases")}
          </Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={() => void (available != null && blocked == null ? download() : check())}
          >
            <RefreshCw size={13} aria-hidden />
            {t("update.retry")}
          </Btn>
        </>
      );
    }
    if (state.phase === Phase.PhaseDownloading) {
      return (
        <Btn onClick={cancel}>
          <X size={13} aria-hidden />
          {t("update.cancel")}
        </Btn>
      );
    }
    if (state.phase === Phase.PhaseReady) {
      return (
        <Btn variant="primary" onClick={() => void install()}>
          <RotateCw size={13} aria-hidden />
          {t("update.installNow")}
        </Btn>
      );
    }
    if (available != null) {
      return (
        <>
          <Btn onClick={skip} disabled={busy}>
            {t("update.skip")}
          </Btn>
          {blocked == null ? (
            <Btn variant="primary" onClick={() => void download()} disabled={busy}>
              <Download size={13} aria-hidden />
              {t("update.download")}
            </Btn>
          ) : (
            <Btn variant="primary" onClick={openReleases}>
              <ExternalLink size={13} aria-hidden />
              {t("page.settings.about.openReleases")}
            </Btn>
          )}
        </>
      );
    }
    return (
      <Btn variant="primary" disabled={busy || state.development} onClick={() => void check()}>
        <RefreshCw size={13} aria-hidden />
        {busy ? t("page.settings.about.checking") : t("page.settings.about.checkUpdate")}
      </Btn>
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
