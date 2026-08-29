import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Check as CheckIcon,
  ChevronLeft,
  Copy,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Github,
  Info,
  MessageSquare,
  RotateCcw,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  Type,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import type { IconType } from "react-icons";
import { Page } from "@/design/shell";
import { AppLogo } from "@/design/icons/AppLogo";
import { FlagIcon } from "@/design/icons/FlagIcon";
import {
  Btn,
  Card,
  OutlineTag,
  Field,
  Menu,
  MenuItem,
  SectionLabel,
  SelectField,
  SettingRow,
  Sw,
  useConfirm,
  useToast,
} from "@/design/ui";
import {
  appVersion,
  dataDirectory,
  openExternal,
  platform,
  revealDataDirectory,
} from "@/api/platform";
import {
  clearCache,
  exportAllConfigToFile,
  importAllConfigFromFile,
} from "@/api/settings";
import { useSettings, type FetchLimit, type Language } from "@/hooks/useSettings";
import { useUIPrefs } from "@/hooks/useUIPrefs";
import { UPDATE_POLICIES } from "@/api/updates";
import { UpdateCard } from "./UpdateCard";
import {
  availableFonts,
  monoFontStack,
  uiFontStack,
  MONO_FONT_CANDIDATES,
  UI_FONT_CANDIDATES,
} from "@/lib/fonts";
import type { ThemeMode } from "@/lib/theme";
import { FONT_SIZES, type UIScaleSetting } from "@/lib/uiScale";
import { cn } from "@/lib/utils";

/**
 * Settings, laid out as the shipped app draws it rather than as board 3g does:
 * a section rail beside a single panel, instead of one column carrying every
 * group at once. Seven sections is more than a column can hold, and the theme
 * cards below need the width the rail's panel gives them.
 *
 * Every row here reads and writes the settings file through `useSettings`,
 * which debounces and serialises the writes -- hence the page's own promise
 * that changes save themselves. The two exceptions are the interface size,
 * which the shell owns because it zooms the whole document, and the motion
 * switch, which is a per-machine preference rather than a stored setting.
 */

const GITHUB_URL = "https://github.com/amigoer/mq-studio";
const GITHUB_ISSUES_URL = "https://github.com/amigoer/mq-studio/issues";

const openLink = (url: string) => void openExternal(url).catch(() => {});

export type SectionId =
  | "appearance"
  | "general"
  | "fonts"
  | "message"
  | "data"
  | "about";

/** Keys, resolved at render so a language change relabels the rail. */
const SECTIONS: readonly { id: SectionId; icon: LucideIcon }[] = [
  { id: "appearance", icon: Sun },
  { id: "general", icon: SettingsIcon },
  { id: "fonts", icon: Type },
  { id: "message", icon: MessageSquare },
  { id: "data", icon: Database },
  { id: "about", icon: Info },
];

const THEMES: readonly { mode: ThemeMode; name: string; desc: string }[] = [
  { mode: "light", name: "page.settings.appearance.light", desc: "page.settings.appearance.lightDesc" },
  { mode: "dark", name: "page.settings.appearance.dark", desc: "page.settings.appearance.darkDesc" },
  { mode: "system", name: "page.settings.appearance.system", desc: "page.settings.appearance.systemDesc" },
];

type Palette = {
  bg: string;
  panel: string;
  border: string;
  fg: string;
  muted: string;
  line: string;
};

/** The shell's own colours, so the light card is a picture of the real thing. */
const LIGHT_P: Palette = {
  bg: "#ffffff",
  panel: "#fcfcfc",
  border: "#ebebeb",
  fg: "#171717",
  muted: "#8a8a8a",
  line: "#f4f4f4",
};
/** The design layer is light-only; these are the values a dark one would take. */
const DARK_P: Palette = {
  bg: "#0a0a0a",
  panel: "#141414",
  border: "#262626",
  fg: "#fafafa",
  muted: "#737373",
  line: "#262626",
};

/** The mark beside the data directory, which is the running host's own. */
const PLATFORM_ICON: Record<ReturnType<typeof platform>, { label: string; Icon: IconType }> = {
  mac: { label: "macOS", Icon: FaApple },
  linux: { label: "Linux", Icon: FaLinux },
  windows: { label: "Windows", Icon: FaWindows },
};

/** The window the theme cards draw: sidebar, title row and three text lines. */
function MiniAppChrome({ p, half }: { p: Palette; half?: "left" | "right" }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", overflow: "hidden" }}>
      {half !== "right" && (
        <div
          style={{
            width: "18px",
            background: p.panel,
            borderRight: `1px solid ${p.border}`,
            padding: "6px 3px",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
          }}
        >
          <div style={{ height: "3px", background: p.fg, opacity: 0.85, borderRadius: "1px" }} />
          <div style={{ height: "3px", background: p.muted, opacity: 0.5, borderRadius: "1px" }} />
          <div style={{ height: "3px", background: p.muted, opacity: 0.5, borderRadius: "1px" }} />
        </div>
      )}
      <div
        style={{
          flex: 1,
          background: p.bg,
          padding: "6px 6px 0",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          <div
            style={{ width: "14px", height: "3px", background: p.fg, opacity: 0.9, borderRadius: "1px" }}
          />
          <span style={{ flex: 1 }} />
          <div
            style={{ width: "6px", height: "3px", background: p.muted, opacity: 0.5, borderRadius: "1px" }}
          />
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "2.5px", marginTop: "2px" }}
        >
          {["85%", "70%", "78%"].map((w) => (
            <div key={w} style={{ height: "2.5px", background: p.line, borderRadius: "1px", width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** An uppercase heading over one card, the shape every panel below is built from. */
function Group({
  title,
  first,
  children,
}: {
  title: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: first ? 0 : "26px" }}>
      <SectionLabel style={{ marginBottom: "10px" }}>{title}</SectionLabel>
      {children}
    </section>
  );
}

type Option<T> = {
  value: T;
  label: string;
  /** Drawn before the label, in the trigger as well as in the menu. */
  mark?: ReactNode;
  /** A second line under the label, for what the option cannot say itself. */
  note?: string;
};

/** `.in3` as a real dropdown: the canvas draws every select as a bordered pill. */
function Dropdown<T extends string | number>({
  value,
  options,
  width = 200,
  onChange,
}: {
  value: T;
  options: readonly Option<T>[];
  width?: number;
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <span style={{ position: "relative" }}>
      <SelectField
        value={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              minWidth: 0,
              /* The caret keeps its place however long the label runs. */
              flex: 1,
              overflow: "hidden",
            }}
          >
            {current?.mark}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {current?.label ?? String(value)}
            </span>
          </span>
        }
        style={{ width: `${width}px`, justifyContent: "space-between" }}
        onClick={() => setOpen((o) => !o)}
      />
      <Menu open={open} onClose={() => setOpen(false)} width={width} top={30}>
        {options.map((o) => (
          <MenuItem
            key={String(o.value)}
            active={o.value === value}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.mark}
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block" }}>{o.label}</span>
              {o.note != null && (
                <span
                  style={{
                    display: "block",
                    fontSize: "var(--set-meta)",
                    color: "var(--c-muted)",
                  }}
                >
                  {o.note}
                </span>
              )}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

/** A number input with its unit beside it. */
function NumField({
  value,
  onChange,
  unit,
  width = 100,
  ...limits
}: {
  value: number;
  onChange: (next: number) => void;
  unit?: string;
  width?: number;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <>
      <Field
        type="number"
        value={value}
        style={{ width: `${width}px` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={() => {
          const { min = -Infinity, max = Infinity } = limits;
          const n = Number.isFinite(value) ? value : min;
          onChange(Math.min(max, Math.max(min, n)));
        }}
        {...limits}
      />
      {unit != null && (
        <span style={{ fontSize: "var(--set-meta)", color: "var(--c-muted)" }}>{unit}</span>
      )}
    </>
  );
}

/**
 * The one control on this page that reaches the whole shell: the size picked
 * here scales every drawn px, chrome included, and 自动 hands that back to the
 * window size. The shipped app pairs -/+ buttons with a fixed number, which has
 * no way to say 自动.
 */
function FontSizeField({
  setting,
  fontSize,
  onChange,
}: {
  setting: UIScaleSetting;
  fontSize: number;
  onChange: (next: UIScaleSetting) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const choose = (next: UIScaleSetting) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <span style={{ position: "relative" }}>
      <SelectField
        value={
          setting === "auto"
            ? t("page.settings.fonts.autoValue", { size: fontSize })
            : `${fontSize}px`
        }
        style={{ width: "200px", justifyContent: "space-between" }}
        onClick={() => setOpen((o) => !o)}
      />
      <Menu open={open} onClose={() => setOpen(false)} width={200} top={30}>
        <MenuItem active={setting === "auto"} onSelect={() => choose("auto")}>
          {t("page.settings.fonts.auto")}
        </MenuItem>
        {FONT_SIZES.map((size) => (
          <MenuItem key={size} active={setting === size} onSelect={() => choose(size)}>
            {size}px
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

function AppearancePanel() {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();
  // Motion is a property of this machine rather than of the account, so it
  // stays out of the settings file and follows the OS until it is set here.
  const { prefs, setAnimations } = useUIPrefs();
  return (
    <>
      <Group title={t("page.settings.appearance.theme")} first>
        <div
          role="radiogroup"
          aria-label={t("page.settings.appearance.theme")}
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}
        >
          {THEMES.map((th) => {
            const active = settings.theme === th.mode;
            const palette = th.mode === "dark" ? DARK_P : LIGHT_P;
            return (
              <button
                key={th.mode}
                type="button"
                role="radio"
                aria-checked={active}
                className="card3"
                onClick={() => setSetting("theme", th.mode)}
                style={{
                  overflow: "hidden",
                  borderColor: active ? "var(--c-fg)" : undefined,
                  boxShadow: active ? "0 0 0 1px var(--c-fg)" : undefined,
                }}
              >
                <div
                  style={{
                    height: "84px",
                    position: "relative",
                    background: palette.bg,
                    borderBottom: "1px solid var(--c-border)",
                  }}
                >
                  {th.mode === "system" ? (
                    /*
                     * Each half needs its own positioned box: both chromes are
                     * `inset: 0`, so sharing one would stack them and the dark
                     * one would paint over the light.
                     */
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                      }}
                    >
                      <span style={{ position: "relative", overflow: "hidden" }}>
                        <MiniAppChrome p={LIGHT_P} half="left" />
                      </span>
                      <span style={{ position: "relative", overflow: "hidden" }}>
                        <MiniAppChrome p={DARK_P} half="right" />
                      </span>
                    </div>
                  ) : (
                    <MiniAppChrome p={palette} />
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "var(--set-label)", fontWeight: 500, lineHeight: 1.25 }}>
                      {t(th.name)}
                    </div>
                    <div style={{ fontSize: "var(--set-hint)", color: "var(--c-muted)", marginTop: "3px" }}>
                      {t(th.desc)}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    style={{
                      width: "16px",
                      height: "16px",
                      flex: "none",
                      borderRadius: "99px",
                      border: `1px solid ${active ? "var(--c-fg)" : "var(--c-border)"}`,
                      background: active ? "var(--c-fg)" : "transparent",
                      color: "var(--c-bg)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {active && <CheckIcon size={10} strokeWidth={3} />}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title={t("page.settings.appearance.motion")}>
        <Card>
          <SettingRow
            label={t("page.settings.appearance.animations")}
            hint={t("page.settings.appearance.animationsHint")}
            last
          >
            <Sw
              checked={prefs.animations}
              onCheckedChange={setAnimations}
              label={t("page.settings.appearance.animations")}
            />
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

/** In the order the picker offers them; the flags come from FlagIcon. */
const LANGUAGES = ["zh", "en"] as const satisfies readonly Language[];

function GeneralPanel() {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();
  return (
    <>
      <Group title={t("page.settings.general.region")} first>
        <Card>
          <SettingRow label={t("page.settings.general.language")} hint={t("page.settings.general.languageHint")}>
            <Dropdown
              value={settings.language}
              onChange={(next) => setSetting("language", next)}
              options={LANGUAGES.map((lang) => ({
                value: lang,
                label: t(`page.settings.general.${lang}`),
                mark: <FlagIcon lang={lang} />,
              }))}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.general.timezone")} hint={t("page.settings.general.timezoneHint")} last>
            <Dropdown
              value={settings.timezone}
              onChange={(next) => setSetting("timezone", next)}
              options={[
                { value: "local", label: t("page.settings.general.local") },
                { value: "utc", label: t("page.settings.general.utc") },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.general.startup")}>
        <Card>
          <SettingRow
            label={t("page.settings.general.autoConnect")}
            hint={t("page.settings.general.autoConnectHint")}
          >
            <Sw
              checked={settings.autoConnectLast}
              onCheckedChange={(next) => setSetting("autoConnectLast", next)}
              label={t("page.settings.general.autoConnect")}
            />
          </SettingRow>
          <SettingRow
            label={t("page.settings.general.updatePolicy")}
            hint={t("page.settings.general.updatePolicyHint")}
            last
          >
            <Dropdown
              /* "Download automatically, install on quit" outruns the drawn 200px. */
              width={240}
              value={settings.updatePolicy}
              onChange={(next) => setSetting("updatePolicy", next)}
              options={UPDATE_POLICIES.map((policy) => ({
                value: policy,
                label: t(`page.settings.general.updatePolicyOption.${policy}`),
              }))}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.general.window")}>
        <Card>
          <SettingRow
            label={t("page.settings.general.closeBehavior")}
            hint={t("page.settings.general.closeBehaviorHint")}
            last
          >
            <Dropdown
              /* "Minimise to the system tray" does not fit the drawn 200px. */
              width={240}
              value={settings.closeBehavior}
              onChange={(next) => setSetting("closeBehavior", next)}
              options={[
                { value: "minimizeToTray", label: t("page.settings.general.tray") },
                { value: "quit", label: t("page.settings.general.quit") },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.general.timeouts")}>
        <Card>
          <SettingRow label={t("page.settings.general.connect")} hint={t("page.settings.general.connectHint")}>
            <NumField
              value={settings.connectTimeoutMs}
              onChange={(next) => setSetting("connectTimeoutMs", next)}
              min={1000}
              max={30000}
              step={1000}
              unit="ms"
            />
          </SettingRow>
          <SettingRow label={t("page.settings.general.request")} hint={t("page.settings.general.requestHint")} last>
            <NumField
              value={settings.requestTimeoutMs}
              onChange={(next) => setSetting("requestTimeoutMs", next)}
              min={1000}
              max={60000}
              step={1000}
              unit="ms"
            />
          </SettingRow>
        </Card>
      </Group>

      <CredentialsGroup />
    </>
  );
}

/** The ACL fallback for connections that carry none of their own. */
function CredentialsGroup() {
  const { t } = useTranslation();
  const { settings, saveGlobalCredentials, clearGlobalCredentials } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  /*
   * The stored keys never reach the renderer -- Go redacts them and reports
   * only whether they are set -- so these two fields always start empty, and
   * what they hold is a replacement rather than the current value.
   */
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [saving, setSaving] = useState(false);

  const configured = settings.globalAccessKeyConfigured && settings.globalSecretKeyConfigured;
  const filled = accessKey.trim() !== "" && secretKey.trim() !== "";

  const save = async () => {
    setSaving(true);
    try {
      await saveGlobalCredentials(accessKey, secretKey);
      setAccessKey("");
      setSecretKey("");
      toast.success(t("page.settings.general.saved"));
    } catch (error) {
      toast.error(t("page.settings.general.saveFailed"), { description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    const confirmed = await confirm({
      title: t("page.settings.general.clearTitle"),
      description: t("page.settings.general.clearDesc"),
      confirmLabel: t("page.settings.general.clear"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearGlobalCredentials();
      setAccessKey("");
      setSecretKey("");
      toast.success(t("page.settings.general.cleared"));
    } catch (error) {
      toast.error(t("page.settings.general.clearFailed"), { description: String(error) });
    }
  };

  return (
    <Group
      title={
        <>
          {t("page.settings.general.credentials")}
          <span style={{ marginLeft: "8px", letterSpacing: 0, textTransform: "none" }}>
            <OutlineTag>
              {configured ? t("page.settings.general.configured") : t("page.settings.general.notConfigured")}
            </OutlineTag>
          </span>
        </>
      }
    >
      <Card>
        <SettingRow label={t("page.settings.general.accessKey")} hint={t("page.settings.general.accessKeyHint")}>
          <Field
            className="mono3"
            style={{ width: "240px" }}
            value={accessKey}
            placeholder={configured ? t("page.settings.general.replaceHint") : "AccessKey"}
            onChange={(e) => setAccessKey(e.target.value)}
          />
        </SettingRow>
        <SettingRow label={t("page.settings.general.secretKey")} hint={t("page.settings.general.secretKeyHint")}>
          <Field
            type="password"
            className="mono3"
            style={{ width: "240px" }}
            value={secretKey}
            placeholder={configured ? t("page.settings.general.replaceHint") : "SecretKey"}
            onChange={(e) => setSecretKey(e.target.value)}
          />
        </SettingRow>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            padding: "11px 16px",
          }}
        >
          {configured && (
            <Btn variant="danger" onClick={() => void clear()}>
              {t("page.settings.general.clear")}
            </Btn>
          )}
          <Btn variant="primary" disabled={!filled || saving} onClick={() => void save()}>
            {saving ? t("page.settings.general.saving") : t("page.settings.general.save")}
          </Btn>
        </div>
      </Card>
    </Group>
  );
}

function FontsPanel({
  scale,
}: {
  scale: { setting: UIScaleSetting; fontSize: number; onChange: (next: UIScaleSetting) => void };
}) {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();

  /*
   * The two menus offer what this machine can actually render. A family the
   * host does not have would fall back silently to the system stack, so the
   * row would report a font the window is not set in. Probing is measurement
   * (see lib/fonts), so it is done once per stored choice rather than on
   * every render.
   */
  const uiFonts = useMemo(
    () => availableFonts(UI_FONT_CANDIDATES, settings.uiFont),
    [settings.uiFont],
  );
  const monoFonts = useMemo(
    () => availableFonts(MONO_FONT_CANDIDATES, settings.monospaceFont),
    [settings.monospaceFont],
  );

  /** Each name is drawn in its own face, which is the only true preview. */
  const fontOptions = (
    fonts: readonly { family: string; installed: boolean }[],
    stack: (family: string) => string,
  ) =>
    fonts.map(({ family, installed }) => ({
      value: family,
      label: family,
      note: installed ? undefined : t("page.settings.fonts.missing"),
      mark: (
        <span aria-hidden style={{ fontFamily: stack(family), color: "var(--c-muted)" }}>
          Aa
        </span>
      ),
    }));

  return (
    <>
      <Group title={t("page.settings.fonts.typography")} first>
        <Card>
          <SettingRow label={t("page.settings.fonts.size")} hint={t("page.settings.fonts.sizeHint")}>
            <FontSizeField
              setting={scale.setting}
              fontSize={scale.fontSize}
              onChange={scale.onChange}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.fonts.uiFont")} hint={t("page.settings.fonts.uiFontHint")}>
            <Dropdown
              value={settings.uiFont}
              onChange={(next) => setSetting("uiFont", next)}
              options={[
                { value: "system", label: t("page.settings.fonts.systemDefault") },
                ...fontOptions(uiFonts, uiFontStack),
              ]}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.fonts.monoFont")} hint={t("page.settings.fonts.monoFontHint")} last>
            <Dropdown
              value={settings.monospaceFont}
              onChange={(next) => setSetting("monospaceFont", next)}
              options={[
                { value: "system", label: t("page.settings.fonts.systemDefault") },
                ...fontOptions(monoFonts, monoFontStack),
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.fonts.time")}>
        <Card>
          <SettingRow label={t("page.settings.fonts.timeFormat")} hint={t("page.settings.fonts.timeFormatHint")} last>
            <Dropdown
              value={settings.timestampFormat}
              onChange={(next) => setSetting("timestampFormat", next)}
              options={[
                { value: "datetime", label: "YYYY-MM-DD HH:mm:ss" },
                { value: "ms", label: t("page.settings.fonts.ms") },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.fonts.preview")}>
        <Card style={{ padding: "14px 16px" }}>
          {/* Both faces at the size and family the window is actually set in,
              so what is read here is what the rest of the shell gets. */}
          <div
            style={{
              fontSize: `${scale.fontSize}px`,
              fontFamily: uiFontStack(settings.uiFont),
              lineHeight: 1.6,
            }}
          >
            {t("page.settings.fonts.previewSample")}
          </div>
          <div
            style={{
              fontSize: `${scale.fontSize - 1}px`,
              color: "var(--c-muted)",
              marginTop: "8px",
              fontFamily: monoFontStack(settings.monospaceFont),
            }}
          >
            msgId: AC1A0F23000078A4F0B8C1234E2F0001
          </div>
        </Card>
      </Group>
    </>
  );
}

/** The ladder the settings store types the limit against. */
const FETCH_LIMITS = [32, 64, 128] as const satisfies readonly FetchLimit[];

function MessagePanel() {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();
  const toast = useToast();

  /*
   * Notifications are the one switch the app cannot grant itself. Asking is
   * left until it is turned on -- a permission prompt on the way past the page
   * would be asking for something nobody requested -- and a refusal puts the
   * switch back rather than storing an intent that can never fire.
   */
  const setDesktopNotifications = async (next: boolean) => {
    if (!next) {
      setSetting("desktopNotifications", false);
      return;
    }
    if (typeof Notification === "undefined") {
      toast.error(t("page.settings.message.notificationsUnsupported"));
      return;
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") {
      toast.error(t("page.settings.message.notificationsDenied"), {
        description: t("page.settings.message.notificationsDeniedHint"),
      });
      return;
    }
    setSetting("desktopNotifications", true);
  };

  return (
    <>
      <Group title={t("page.settings.message.defaults")} first>
        <Card>
          <SettingRow label={t("page.settings.message.fetchLimit")} hint={t("page.settings.message.fetchLimitHint")}>
            <Dropdown
              width={140}
              value={settings.fetchLimit}
              onChange={(next) => setSetting("fetchLimit", next)}
              options={FETCH_LIMITS.map((n) => ({
                value: n,
                label: t("page.settings.message.fetchLimitUnit", { count: n }),
              }))}
            />
          </SettingRow>
          <SettingRow
            label={t("page.settings.message.autoFormatJson")}
            hint={t("page.settings.message.autoFormatJsonHint")}
          >
            <Sw
              checked={settings.autoFormatJson}
              onCheckedChange={(next) => setSetting("autoFormatJson", next)}
              label={t("page.settings.message.autoFormatJson")}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.message.payload")} hint={t("page.settings.message.payloadHint")} last>
            <NumField
              value={Math.round(settings.maxPayloadRenderBytes / 1024)}
              onChange={(next) => setSetting("maxPayloadRenderBytes", next * 1024)}
              min={64}
              max={4096}
              unit="KB"
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.message.thresholds")}>
        <Card>
          <SettingRow label={t("page.settings.message.lag")} hint={t("page.settings.message.lagHint")}>
            <NumField
              value={settings.lagAlertThreshold}
              onChange={(next) => setSetting("lagAlertThreshold", next)}
              min={0}
              step={1000}
              width={120}
              unit={t("page.settings.message.lagUnit")}
            />
          </SettingRow>
          <SettingRow label={t("page.settings.message.disk")} hint={t("page.settings.message.diskHint")}>
            <NumField
              value={settings.diskAlertThreshold}
              onChange={(next) => setSetting("diskAlertThreshold", next)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </SettingRow>
          <SettingRow
            label={t("page.settings.message.notifications")}
            hint={t("page.settings.message.notificationsHint")}
            last
          >
            <Sw
              checked={settings.desktopNotifications}
              onCheckedChange={(next) => void setDesktopNotifications(next)}
              label={t("page.settings.message.notifications")}
            />
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

function DataPanel() {
  const { t } = useTranslation();
  const { reloadSettings } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [directory, setDirectory] = useState("");
  const [copied, setCopied] = useState(false);
  const { label: platformLabel, Icon } = PLATFORM_ICON[platform()];

  useEffect(() => {
    let cancelled = false;
    dataDirectory()
      .then((path) => {
        if (!cancelled) setDirectory(path);
      })
      .catch(() => {
        // Nothing the reader can act on; the row keeps its placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    navigator.clipboard
      .writeText(directory)
      .then(() => setCopied(true))
      .catch(() => toast.error(t("page.settings.data.copyFailed")));
  };

  const reveal = async () => {
    try {
      await revealDataDirectory();
    } catch (error) {
      toast.error(t("page.settings.data.openFailed"), { description: String(error) });
    }
  };

  const exportConfig = async () => {
    try {
      const path = await exportAllConfigToFile();
      // An empty path is the save dialog being dismissed, not a failure.
      if (path == null) return;
      toast.success(t("page.settings.data.exported"), { description: path });
    } catch (error) {
      toast.error(t("page.settings.data.exportFailed"), { description: String(error) });
    }
  };

  const importConfig = async () => {
    // Go applies the file as soon as it is chosen, so the question has to come
    // before the dialog rather than after it.
    const confirmed = await confirm({
      title: t("page.settings.data.import"),
      description: t("page.settings.data.importDesc"),
      confirmLabel: t("page.settings.data.importConfirm"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const path = await importAllConfigFromFile();
      if (path == null) return;
      await reloadSettings();
      toast.success(t("page.settings.data.imported"), { description: path });
    } catch (error) {
      toast.error(t("page.settings.data.importFailed"), { description: String(error) });
    }
  };

  const clear = async () => {
    const confirmed = await confirm({
      title: t("page.settings.data.clearCache"),
      description: t("page.settings.data.clearCacheDesc"),
      confirmLabel: t("page.settings.data.clearCache"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await clearCache();
      toast.success(t("page.settings.data.cacheCleared"));
    } catch (error) {
      toast.error(t("page.settings.data.clearCacheFailed"), { description: String(error) });
    }
  };

  return (
    <>
      <Group title={t("page.settings.data.location")} first>
        <Card>
          <SettingRow
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <Icon size={13} color="var(--c-muted)" aria-hidden />
                {platformLabel}
              </span>
            }
            hint={
              <code className="mono3" style={{ fontSize: "var(--set-hint)", wordBreak: "break-all" }}>
                {directory || t("page.settings.data.loading")}
              </code>
            }
            last
          >
            <Btn disabled={directory === ""} onClick={copy}>
              <Copy size={13} aria-hidden />
              {copied ? t("page.settings.data.copied") : t("page.settings.data.copyPath")}
            </Btn>
            <Btn disabled={directory === ""} onClick={() => void reveal()}>
              <FolderOpen size={13} aria-hidden />
              {t("page.settings.data.openDirectory")}
            </Btn>
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.data.transfer")}>
        <Card>
          <SettingRow
            label={t("page.settings.data.export")}
            hint={t("page.settings.data.exportHint")}
          >
            <Btn onClick={() => void exportConfig()}>
              <Download size={13} aria-hidden />
              {t("page.settings.data.exportAction")}
            </Btn>
          </SettingRow>
          <SettingRow label={t("page.settings.data.import")} hint={t("page.settings.data.importHint")} last>
            <Btn onClick={() => void importConfig()}>
              <Upload size={13} aria-hidden />
              {t("page.settings.data.importAction")}
            </Btn>
          </SettingRow>
        </Card>
      </Group>

      <Group title={t("page.settings.data.cleanup")}>
        <Card>
          <SettingRow label={t("page.settings.data.clearCache")} hint={t("page.settings.data.clearCacheHint")} last>
            <Btn variant="danger" onClick={() => void clear()}>
              <Trash2 size={13} aria-hidden />
              {t("page.settings.data.clearCache")}
            </Btn>
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

export type DocId = "capability" | "reuse" | "nav";

function AboutPanel({ onOpenDoc }: { onOpenDoc?: (doc: DocId) => void }) {
  const { t } = useTranslation();
  const { resetAllSettings } = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    appVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        // The dash below is the honest answer when Go cannot be reached.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reset = async () => {
    const confirmed = await confirm({
      title: t("page.settings.about.reset"),
      description: t("page.settings.about.resetDesc"),
      confirmLabel: t("page.settings.about.resetAction"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await resetAllSettings();
      toast.success(t("page.settings.about.resetDone"));
    } catch (error) {
      toast.error(t("page.settings.about.resetFailed"), { description: String(error) });
    }
  };

  return (
    <>
      <Card style={{ padding: "18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <AppLogo width={40} height={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px" }}
            >
              <h2 style={{ margin: 0, fontSize: "var(--set-title)", fontWeight: 600 }}>MQ Studio</h2>
              <span className="mono3" style={{ fontSize: "var(--set-meta)", color: "var(--c-muted)" }}>
                {/* A development build reports "dev", which no v belongs in front of. */}
                {version == null ? "—" : version === "dev" ? "dev" : `v${version}`}
              </span>
              <OutlineTag>Apache-2.0</OutlineTag>
            </div>
            {/* One paragraph now that the page follows the interface language;
                it used to carry both at once because nothing else did. */}
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--set-hint)",
                color: "var(--c-muted)",
                lineHeight: 1.6,
              }}
            >
              {t("page.settings.about.blurb")}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
          <Btn onClick={() => openLink(GITHUB_URL)}>
            <Github size={13} aria-hidden />
            GitHub
          </Btn>
          <Btn onClick={() => openLink(GITHUB_ISSUES_URL)}>
            <ExternalLink size={13} aria-hidden />
            {t("page.settings.about.issue")}
          </Btn>
        </div>
      </Card>

      <div style={{ marginTop: "14px" }}>
        <UpdateCard />
      </div>

      <Card style={{ marginTop: "14px" }}>
        <SettingRow label={t("page.settings.about.reset")} hint={t("page.settings.about.resetHint")} last>
          <Btn variant="danger" onClick={() => void reset()}>
            <RotateCcw size={13} aria-hidden />
            {t("page.settings.about.resetAction")}
          </Btn>
        </SettingRow>
      </Card>

      {/*
       * Boards 3h / 4d / 5c are specification pages with no entry point drawn in
       * the canvas; this group is the only addition to what the shipped settings
       * page carries.
       */}
      <Group title={t("page.settings.about.reference")}>
        <Card>
          <SettingRow
            label={t("page.settings.about.referenceLabel")}
            hint={t("page.settings.about.referenceHint")}
            last
          >
            <Btn onClick={() => onOpenDoc?.("capability")}>{t("page.settings.about.capability")}</Btn>
            <Btn onClick={() => onOpenDoc?.("reuse")}>{t("page.settings.about.reuse")}</Btn>
            <Btn onClick={() => onOpenDoc?.("nav")}>{t("page.settings.about.navModel")}</Btn>
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

export function Settings({
  onBack,
  onOpenDoc,
  scale,
  /** Which section to open on; the notification popover links straight to one. */
  initialSection = "appearance",
}: {
  onBack?: () => void;
  onOpenDoc?: (doc: DocId) => void;
  scale: {
    setting: UIScaleSetting;
    fontSize: number;
    onChange: (next: UIScaleSetting) => void;
  };
  initialSection?: SectionId;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>(initialSection);

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  // Only the selected entry is rendered, so each panel reads the settings store
  // for itself rather than being handed a copy from here.
  const panel: Record<SectionId, ReactNode> = {
    appearance: <AppearancePanel />,
    general: <GeneralPanel />,
    fonts: <FontsPanel scale={scale} />,
    message: <MessagePanel />,
    data: <DataPanel />,
    about: <AboutPanel onOpenDoc={onOpenDoc} />,
  };

  return (
    /* `set3` is the page's own type scale; see the block in tokens.css. */
    <Page className="set3">
      <div className="hd3" style={{ alignItems: "center" }}>
        <Btn style={{ padding: "4.5px 9px" }} onClick={onBack}>
          <ChevronLeft size={13} aria-hidden />
          {t("page.settings.back")}
        </Btn>
        <h2>{t("page.settings.title")}</h2>
        <span style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <nav
          className="mqs-scroll side3"
          aria-label={t("page.settings.sectionsNav")}
          style={{ gap: "2px", overflowX: "hidden", overflowY: "auto" }}
        >
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={cn("ni", active && "on")}
                onClick={() => setSection(s.id)}
              >
                <span className="nic">
                  <s.icon size={16} aria-hidden />
                </span>
                <span className="nil">{t(`page.settings.section.${s.id}`)}</span>
              </button>
            );
          })}
        </nav>

        <div className="mqs-scroll" style={{ flex: 1, minWidth: 0, padding: "16px 20px" }}>
          <div style={{ maxWidth: "860px", margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "var(--set-title)", fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {t(`page.settings.section.${current.id}`)}
                </div>
                <div style={{ fontSize: "var(--set-sub)", color: "var(--c-muted)", marginTop: "3px" }}>
                  {t(`page.settings.section.${current.id}Sub`)}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "var(--set-meta)", color: "var(--c-muted)", flex: "none" }}>
                {t("page.settings.autoSaved")}
              </span>
            </div>

            <div key={section} className="mqs-view">
              {panel[section]}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
