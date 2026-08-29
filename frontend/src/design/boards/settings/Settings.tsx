import { useEffect, useState, type ReactNode } from "react";
import {
  Check as CheckIcon,
  ChevronLeft,
  Database,
  Download,
  ExternalLink,
  Github,
  Globe,
  Info,
  MessageSquare,
  RefreshCw,
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
import {
  Btn,
  Card,
  EnvTag,
  Field,
  Menu,
  MenuItem,
  SectionLabel,
  SelectField,
  SettingRow,
  Sw,
} from "@/design/ui";
import { openExternal } from "@/api/platform";
import { FONT_SIZES, type UIScaleSetting } from "@/lib/uiScale";
import { cn } from "@/lib/utils";

/**
 * Settings, laid out as the shipped app draws it rather than as board 3g does:
 * a section rail beside a single panel, instead of one column carrying every
 * group at once. Seven sections is more than a column can hold, and the theme
 * cards below need the width the rail's panel gives them.
 *
 * Static, like the rest of the restoration: the rows carry their drawn values
 * and `@/hooks/useSettings` stays unwired. The exceptions are the two controls
 * that already act on the running shell -- the UI scale, and the links that go
 * out through the host.
 */

const GITHUB_URL = "https://github.com/amigoer/mq-studio";
const GITHUB_ISSUES_URL = "https://github.com/amigoer/mq-studio/issues";

const openLink = (url: string) => void openExternal(url).catch(() => {});

type SectionId = "appearance" | "general" | "fonts" | "message" | "proxy" | "data" | "about";

const SECTIONS: readonly { id: SectionId; icon: LucideIcon; label: string; subtitle: string }[] = [
  { id: "appearance", icon: Sun, label: "外观", subtitle: "主题与界面动效" },
  { id: "general", icon: SettingsIcon, label: "通用", subtitle: "语言、连接与默认行为" },
  { id: "fonts", icon: Type, label: "字体与显示", subtitle: "字号、字体与时间格式" },
  { id: "message", icon: MessageSquare, label: "消息查询", subtitle: "默认查询与告警参数" },
  { id: "proxy", icon: Globe, label: "代理与网络", subtitle: "代理、超时与默认凭证" },
  { id: "data", icon: Database, label: "数据与备份", subtitle: "导入导出、数据目录与缓存" },
  { id: "about", icon: Info, label: "关于", subtitle: "版本与项目信息" },
];

type ThemeMode = "light" | "dark" | "system";

const THEMES: readonly { mode: ThemeMode; name: string; desc: string }[] = [
  { mode: "light", name: "浅色", desc: "默认" },
  { mode: "dark", name: "深色", desc: "护眼" },
  { mode: "system", name: "跟随系统", desc: "自动切换" },
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

const DATA_PATHS: readonly { platform: string; path: string; Icon: IconType }[] = [
  { platform: "macOS", path: "~/Library/Application Support/mq-studio/", Icon: FaApple },
  { platform: "Linux", path: "~/.config/mq-studio/", Icon: FaLinux },
  { platform: "Windows", path: "%AppData%\\mq-studio\\", Icon: FaWindows },
];

/**
 * Every value the panels below can change. One object, so a section keeps its
 * edits while the rail is showing another one.
 */
type Draft = {
  theme: ThemeMode;
  animations: boolean;
  language: string;
  timezone: string;
  autoConnect: boolean;
  autoCheckUpdate: boolean;
  closeBehavior: string;
  uiFont: string;
  monoFont: string;
  timeFormat: string;
  fetchLimit: number;
  autoFormatJson: boolean;
  payloadKB: number;
  lagAlert: number;
  diskAlert: number;
  desktopNotifications: boolean;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  accessKey: string;
  secretKey: string;
};

const DRAFT: Draft = {
  theme: "system",
  animations: true,
  language: "zh",
  timezone: "local",
  autoConnect: true,
  autoCheckUpdate: true,
  closeBehavior: "tray",
  uiFont: "system",
  monoFont: "JetBrains Mono",
  timeFormat: "datetime",
  fetchLimit: 64,
  autoFormatJson: true,
  payloadKB: 500,
  lagAlert: 10000,
  diskAlert: 85,
  desktopNotifications: true,
  connectTimeoutMs: 3000,
  requestTimeoutMs: 5000,
  accessKey: "",
  secretKey: "",
};

type Setter = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

type PanelProps = { draft: Draft; set: Setter };

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

/** `.in3` as a real dropdown: the canvas draws every select as a bordered pill. */
function Dropdown<T extends string | number>({
  value,
  options,
  width = 200,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  width?: number;
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <span style={{ position: "relative" }}>
      <SelectField
        value={current?.label ?? String(value)}
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
            {o.label}
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
      {unit != null && <span style={{ fontSize: "11px", color: "#8a8a8a" }}>{unit}</span>}
    </>
  );
}

const scaleLabel = (setting: UIScaleSetting, fontSize: number) =>
  setting === "auto" ? `自动 · ${fontSize}px` : `${fontSize}px`;

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
  const [open, setOpen] = useState(false);
  const choose = (next: UIScaleSetting) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <span style={{ position: "relative" }}>
      <SelectField
        value={scaleLabel(setting, fontSize)}
        style={{ width: "200px", justifyContent: "space-between" }}
        onClick={() => setOpen((o) => !o)}
      />
      <Menu open={open} onClose={() => setOpen(false)} width={200} top={30}>
        <MenuItem active={setting === "auto"} onSelect={() => choose("auto")}>
          自动（跟随窗口）
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

function AppearancePanel({ draft, set }: PanelProps) {
  return (
    <>
      <Group title="主题" first>
        <div
          role="radiogroup"
          aria-label="主题"
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}
        >
          {THEMES.map((th) => {
            const active = draft.theme === th.mode;
            const palette = th.mode === "dark" ? DARK_P : LIGHT_P;
            return (
              <button
                key={th.mode}
                type="button"
                role="radio"
                aria-checked={active}
                className="card3"
                onClick={() => set("theme", th.mode)}
                style={{
                  overflow: "hidden",
                  borderColor: active ? "#171717" : undefined,
                  boxShadow: active ? "0 0 0 1px #171717" : undefined,
                }}
              >
                <div
                  style={{
                    height: "84px",
                    position: "relative",
                    background: palette.bg,
                    borderBottom: "1px solid #ebebeb",
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
                    <div style={{ fontSize: "12.5px", fontWeight: 500, lineHeight: 1.2 }}>
                      {th.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "#8a8a8a", marginTop: "2px" }}>
                      {th.desc}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    style={{
                      width: "16px",
                      height: "16px",
                      flex: "none",
                      borderRadius: "99px",
                      border: `1px solid ${active ? "#171717" : "#ebebeb"}`,
                      background: active ? "#171717" : "transparent",
                      color: "#fff",
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

      <Group title="动效与可访问性">
        <Card>
          <SettingRow label="界面过渡动画" hint="页面切换、面板展开等过渡效果" last>
            <Sw
              checked={draft.animations}
              onCheckedChange={(next) => set("animations", next)}
              label="界面过渡动画"
            />
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

function GeneralPanel({ draft, set }: PanelProps) {
  return (
    <>
      <Group title="语言与区域" first>
        <Card>
          <SettingRow label="界面语言" hint="切换后立即生效">
            <Dropdown
              value={draft.language}
              onChange={(next) => set("language", next)}
              options={[
                { value: "zh", label: "简体中文" },
                { value: "en", label: "English" },
              ]}
            />
          </SettingRow>
          <SettingRow label="时区" hint="影响列表与详情中的时间显示" last>
            <Dropdown
              value={draft.timezone}
              onChange={(next) => set("timezone", next)}
              options={[
                { value: "local", label: "本地时间" },
                { value: "utc", label: "UTC" },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title="启动行为">
        <Card>
          <SettingRow label="启动时自动连接" hint="恢复上次在线的全部连接（多连接）">
            <Sw
              checked={draft.autoConnect}
              onCheckedChange={(next) => set("autoConnect", next)}
              label="启动时自动连接"
            />
          </SettingRow>
          <SettingRow
            label="自动检查更新"
            hint="启动后及每 24 小时向 GitHub 查询是否有新版本，仅发送当前版本号"
            last
          >
            <Sw
              checked={draft.autoCheckUpdate}
              onCheckedChange={(next) => set("autoCheckUpdate", next)}
              label="自动检查更新"
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title="窗口行为">
        <Card>
          <SettingRow
            label="关闭主窗口时"
            hint="最小化到托盘后应用继续在后台采集吞吐数据，可从菜单栏图标唤回或退出"
            last
          >
            <Dropdown
              value={draft.closeBehavior}
              onChange={(next) => set("closeBehavior", next)}
              options={[
                { value: "tray", label: "最小化到系统托盘" },
                { value: "quit", label: "退出应用" },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

function FontsPanel({
  draft,
  set,
  scale,
}: PanelProps & {
  scale: { setting: UIScaleSetting; fontSize: number; onChange: (next: UIScaleSetting) => void };
}) {
  return (
    <>
      <Group title="字体与排版" first>
        <Card>
          <SettingRow label="界面字号" hint="⌘+ / ⌘- 逐档调整，⌘0 回到自动">
            <FontSizeField
              setting={scale.setting}
              fontSize={scale.fontSize}
              onChange={scale.onChange}
            />
          </SettingRow>
          <SettingRow label="界面字体" hint="默认使用系统 UI 字体">
            <Dropdown
              value={draft.uiFont}
              onChange={(next) => set("uiFont", next)}
              options={[
                { value: "system", label: "系统默认" },
                { value: "Inter", label: "Inter" },
                { value: "PingFang SC", label: "PingFang SC" },
                { value: "Microsoft YaHei", label: "Microsoft YaHei" },
                { value: "Noto Sans SC", label: "Noto Sans SC" },
                { value: "HarmonyOS Sans", label: "HarmonyOS Sans" },
              ]}
            />
          </SettingRow>
          <SettingRow label="等宽字体" hint="用于消息体、ID、JSON 显示" last>
            <Dropdown
              value={draft.monoFont}
              onChange={(next) => set("monoFont", next)}
              options={[
                { value: "JetBrains Mono", label: "JetBrains Mono" },
                { value: "Fira Code", label: "Fira Code" },
                { value: "Source Code Pro", label: "Source Code Pro" },
                { value: "Cascadia Code", label: "Cascadia Code" },
                { value: "Menlo", label: "Menlo" },
                { value: "Consolas", label: "Consolas" },
                { value: "system", label: "系统默认" },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title="时间显示">
        <Card>
          <SettingRow label="时间格式" hint="影响列表与详情中的时间显示" last>
            <Dropdown
              value={draft.timeFormat}
              onChange={(next) => set("timeFormat", next)}
              options={[
                { value: "datetime", label: "YYYY-MM-DD HH:mm:ss" },
                { value: "ms", label: "毫秒时间戳" },
              ]}
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title="预览">
        <Card style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: `${scale.fontSize}px` }}>
            示例文本：MQ Studio · 多协议消息队列桌面客户端 ABCDabcd 1234
          </div>
          <div
            className="mono3"
            style={{
              fontSize: "11.5px",
              color: "#8a8a8a",
              marginTop: "6px",
              fontFamily: `"${draft.monoFont}", ui-monospace, Menlo, monospace`,
            }}
          >
            msgId: AC1A0F23000078A4F0B8C1234E2F0001
          </div>
        </Card>
      </Group>
    </>
  );
}

function MessagePanel({ draft, set }: PanelProps) {
  return (
    <>
      <Group title="消息查询默认值" first>
        <Card>
          <SettingRow label="单页拉取数量" hint="每次查询主题、消费组的数量上限">
            <Dropdown
              width={140}
              value={draft.fetchLimit}
              onChange={(next) => set("fetchLimit", next)}
              options={[32, 64, 128].map((n) => ({ value: n, label: `${n} 条` }))}
            />
          </SettingRow>
          <SettingRow label="JSON 自动格式化" hint="查看消息时自动美化 JSON 内容">
            <Sw
              checked={draft.autoFormatJson}
              onCheckedChange={(next) => set("autoFormatJson", next)}
              label="JSON 自动格式化"
            />
          </SettingRow>
          <SettingRow label="消息截断阈值" hint="超过此大小的消息内容将被截断显示" last>
            <NumField
              value={draft.payloadKB}
              onChange={(next) => set("payloadKB", next)}
              min={64}
              max={4096}
              unit="KB"
            />
          </SettingRow>
        </Card>
      </Group>

      <Group title="告警阈值">
        <Card>
          <SettingRow label="消费积压告警" hint="当消费组堆积消息超过此值时显示告警，设为 0 关闭">
            <NumField
              value={draft.lagAlert}
              onChange={(next) => set("lagAlert", next)}
              min={0}
              step={1000}
              width={120}
              unit="条"
            />
          </SettingRow>
          <SettingRow label="磁盘水位告警" hint="Broker 磁盘使用率达到此百分比时告警，设为 0 关闭">
            <NumField
              value={draft.diskAlert}
              onChange={(next) => set("diskAlert", next)}
              min={0}
              max={100}
              step={5}
              unit="%"
            />
          </SettingRow>
          <SettingRow label="系统通知" hint="出现新告警时发送桌面通知（需系统授权）" last>
            <Sw
              checked={draft.desktopNotifications}
              onCheckedChange={(next) => set("desktopNotifications", next)}
              label="系统通知"
            />
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

function ProxyPanel({ draft, set }: PanelProps) {
  const filled = draft.accessKey.trim() !== "" && draft.secretKey.trim() !== "";
  return (
    <>
      <Group title="连接超时" first>
        <Card>
          <SettingRow label="连接超时" hint="建立集群连接的最大等待时间">
            <NumField
              value={draft.connectTimeoutMs}
              onChange={(next) => set("connectTimeoutMs", next)}
              min={1000}
              max={30000}
              step={1000}
              unit="ms"
            />
          </SettingRow>
          <SettingRow label="请求超时" hint="查询主题、消费组等操作的超时时间" last>
            <NumField
              value={draft.requestTimeoutMs}
              onChange={(next) => set("requestTimeoutMs", next)}
              min={1000}
              max={60000}
              step={1000}
              unit="ms"
            />
          </SettingRow>
        </Card>
      </Group>

      <Group
        title={
          <>
            默认凭证
            <span style={{ marginLeft: "8px", letterSpacing: 0, textTransform: "none" }}>
              <EnvTag>未配置</EnvTag>
            </span>
          </>
        }
      >
        <Card>
          <SettingRow label="默认 AccessKey" hint="连接未单独开启 ACL 时，自动用此凭证鉴权">
            <Field
              className="mono3"
              style={{ width: "240px" }}
              value={draft.accessKey}
              placeholder="AccessKey"
              onChange={(e) => set("accessKey", e.target.value)}
            />
          </SettingRow>
          <SettingRow label="默认 SecretKey" hint="加密存储于本地；连接级 ACL 优先">
            <Field
              type="password"
              className="mono3"
              style={{ width: "240px" }}
              value={draft.secretKey}
              placeholder="SecretKey"
              onChange={(e) => set("secretKey", e.target.value)}
            />
          </SettingRow>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "11px 16px" }}>
            <Btn variant="primary" disabled={!filled}>
              保存凭证
            </Btn>
          </div>
        </Card>
      </Group>

      <Group title="高级（暂未支持）">
        <Card>
          <div
            style={{ fontSize: "11px", color: "#8a8a8a", padding: "12px 16px", lineHeight: 1.55 }}
          >
            代理与 TLS 跳过依赖各驱动底层客户端的能力，当前版本尚未接入。默认
            AccessKey/SecretKey 已生效：连接未启用 ACL 时会自动使用。
          </div>
          <SettingRow label="跳过 TLS 校验" hint="当前驱动客户端不支持 TLS 选项">
            <EnvTag>暂未支持</EnvTag>
          </SettingRow>
          <SettingRow label="启用代理" hint="当前驱动客户端不支持 HTTP/SOCKS 代理" last>
            <EnvTag>暂未支持</EnvTag>
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

function DataPanel() {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (copied == null) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = (path: string) => {
    navigator.clipboard
      .writeText(path)
      .then(() => setCopied(path))
      .catch(() => {});
  };

  return (
    <>
      <Group title="数据存储位置" first>
        <Card style={{ overflow: "hidden" }}>
          {DATA_PATHS.map(({ platform, path, Icon }, i) => (
            <button
              key={platform}
              type="button"
              className="srow"
              aria-label={`复制 ${platform} 数据目录`}
              onClick={() => copy(path)}
              style={{
                width: "100%",
                border: "none",
                borderTop: i > 0 ? "1px solid #f4f4f4" : undefined,
                background: "none",
                font: "inherit",
                fontSize: "12.5px",
                color: "inherit",
                textAlign: "left",
              }}
            >
              <Icon size={13} color="#8a8a8a" aria-hidden />
              <span style={{ width: "72px", flex: "none" }}>{platform}</span>
              <code
                className="mono3"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: "11.5px",
                  color: "#8a8a8a",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {path}
              </code>
              <span style={{ fontSize: "10.5px", color: "#8a8a8a", flex: "none" }}>
                {copied === path ? "已复制" : "点击复制"}
              </span>
            </button>
          ))}
        </Card>
      </Group>

      <Group title="导入与导出">
        <Card>
          <SettingRow
            label="导出全部配置"
            hint="导出连接、ACL、应用设置；文件包含明文凭据，请妥善保管"
          >
            <Btn>
              <Download size={13} aria-hidden />
              导出
            </Btn>
          </SettingRow>
          <SettingRow label="导入配置" hint="从 JSON 文件恢复并立即重新加载连接与设置" last>
            <Btn>
              <Upload size={13} aria-hidden />
              选择文件
            </Btn>
          </SettingRow>
        </Card>
      </Group>

      <Group title="清理">
        <Card>
          <SettingRow label="清理缓存" hint="清除本地的查询、消息缓存数据" last>
            <Btn variant="danger">
              <Trash2 size={13} aria-hidden />
              清理缓存
            </Btn>
          </SettingRow>
        </Card>
      </Group>
    </>
  );
}

export type DocId = "capability" | "reuse" | "nav";

function AboutPanel({ onOpenDoc }: { onOpenDoc?: (doc: DocId) => void }) {
  return (
    <>
      <Card style={{ padding: "18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <AppLogo width={40} height={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "8px" }}
            >
              <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>MQ Studio</h2>
              <span className="mono3" style={{ fontSize: "11.5px", color: "#8a8a8a" }}>
                v0.2.0
              </span>
              <EnvTag>Apache-2.0</EnvTag>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "11.5px", color: "#8a8a8a", lineHeight: 1.55 }}>
              本地优先的消息队列桌面客户端，无需额外部署控制台，即可管理 RocketMQ、Kafka、
              RabbitMQ、Pulsar、Redis 与 MQTT 的集群、主题、消费者与消息。
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8a8a8a", lineHeight: 1.5 }}>
              A local-first desktop client for message queues. Manage clusters, topics, consumers
              and messages across six brokers without deploying a separate console.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
          <Btn variant="primary">
            <RefreshCw size={13} aria-hidden />
            检查更新
          </Btn>
          <Btn onClick={() => openLink(GITHUB_URL)}>
            <Github size={13} aria-hidden />
            GitHub
          </Btn>
          <Btn onClick={() => openLink(GITHUB_ISSUES_URL)}>
            <ExternalLink size={13} aria-hidden />
            提交 Issue
          </Btn>
        </div>
      </Card>

      <Card style={{ marginTop: "14px" }}>
        <SettingRow label="恢复默认设置" hint="将所有设置恢复为初始值（不影响连接）" last>
          <Btn variant="danger">
            <RotateCcw size={13} aria-hidden />
            恢复默认
          </Btn>
        </SettingRow>
      </Card>

      {/*
       * Boards 3h / 4d / 5c are specification pages with no entry point drawn in
       * the canvas; this group is the only addition to what the shipped settings
       * page carries.
       */}
      <Group title="设计参考">
        <Card>
          <SettingRow
            label="协议能力矩阵 · 复用策略 · 导航模型"
            hint="设计稿 3h / 4d / 5c，说明各页面按协议如何裁剪"
            last
          >
            <Btn onClick={() => onOpenDoc?.("capability")}>能力矩阵</Btn>
            <Btn onClick={() => onOpenDoc?.("reuse")}>复用策略</Btn>
            <Btn onClick={() => onOpenDoc?.("nav")}>导航模型</Btn>
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
}: {
  onBack?: () => void;
  onOpenDoc?: (doc: DocId) => void;
  scale: {
    setting: UIScaleSetting;
    fontSize: number;
    onChange: (next: UIScaleSetting) => void;
  };
}) {
  const [section, setSection] = useState<SectionId>("appearance");
  const [draft, setDraft] = useState<Draft>(DRAFT);
  const set: Setter = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const panel: Record<SectionId, ReactNode> = {
    appearance: <AppearancePanel draft={draft} set={set} />,
    general: <GeneralPanel draft={draft} set={set} />,
    fonts: <FontsPanel draft={draft} set={set} scale={scale} />,
    message: <MessagePanel draft={draft} set={set} />,
    proxy: <ProxyPanel draft={draft} set={set} />,
    data: <DataPanel />,
    about: <AboutPanel onOpenDoc={onOpenDoc} />,
  };

  return (
    <Page>
      <div className="hd3" style={{ alignItems: "center" }}>
        <Btn style={{ padding: "4.5px 9px" }} onClick={onBack}>
          <ChevronLeft size={13} aria-hidden />
          返回
        </Btn>
        <h2>设置</h2>
        <span style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <nav
          className="mqs-scroll side3"
          aria-label="设置分区"
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
                <span className="nil">{s.label}</span>
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
                <div style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "-0.01em" }}>
                  {current.label}
                </div>
                <div style={{ fontSize: "11.5px", color: "#8a8a8a", marginTop: "2px" }}>
                  {current.subtitle}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "11px", color: "#8a8a8a", flex: "none" }}>
                所有更改自动保存
              </span>
            </div>

            {panel[section]}
          </div>
        </div>
      </div>
    </Page>
  );
}
