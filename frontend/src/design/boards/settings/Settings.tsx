import { useState } from "react";
import { Page } from "@/design/shell";
import { Btn, Card, SectionLabel, Seg, SelectField, SettingRow, Sw } from "@/design/ui";

const THEMES = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;

const NO_BORDER = { borderBottom: "none" } as const;

/** Board 3g — settings is a global view: no connection sidebar, centred column. */
export type DocId = "capability" | "reuse" | "nav";

export function Settings({
  onBack,
  onOpenDoc,
}: {
  onBack?: () => void;
  /**
   * Boards 3h / 4d / 5c are specification pages with no entry point drawn in
   * the canvas; this row is the only addition to 3g.
   */
  onOpenDoc?: (doc: DocId) => void;
}) {
  const [theme, setTheme] = useState<(typeof THEMES)[number]["value"]>("light");
  const [autoConnect, setAutoConnect] = useState(true);
  const [desktopAlerts, setDesktopAlerts] = useState(true);

  return (
    <Page>
      <div className="hd3">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Btn style={{ padding: "4.5px 9px" }} onClick={onBack}>
            ‹ 返回
          </Btn>
          <div>
            <h2>设置</h2>
            <div className="sub">全局视图（无连接侧边栏）· 从标题栏 ⚙ 进入 · GitHub 链接在「关于」</div>
          </div>
        </div>
        <span style={{ flex: 1 }} />
      </div>

      <div className="mqs-scroll" style={{ flex: 1, minHeight: 0, padding: "18px 0" }}>
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            padding: "0 24px",
          }}
        >
          <section>
            <SectionLabel style={{ marginBottom: "8px" }}>外观</SectionLabel>
            <Card>
              <SettingRow label="主题">
                <Seg options={THEMES} value={theme} onChange={setTheme} />
              </SettingRow>
              <SettingRow label="语言">
                <SelectField value="简体中文" />
              </SettingRow>
              <SettingRow label="界面字号 / 等宽字体" style={NO_BORDER}>
                <SelectField value="13px" />
                <SelectField value="JetBrains Mono" />
              </SettingRow>
            </Card>
          </section>

          <section>
            <SectionLabel style={{ marginBottom: "8px" }}>行为</SectionLabel>
            <Card>
              <SettingRow label="关闭窗口时">
                <SelectField value="最小化到托盘" />
              </SettingRow>
              <SettingRow label="启动时自动连接" hint="恢复上次在线的全部连接（多连接）">
                <Sw checked={autoConnect} onCheckedChange={setAutoConnect} label="启动时自动连接" />
              </SettingRow>
              <SettingRow label="数据刷新间隔 / 桌面告警" style={NO_BORDER}>
                <SelectField value="10 秒" />
                <Sw checked={desktopAlerts} onCheckedChange={setDesktopAlerts} label="桌面告警" />
              </SettingRow>
            </Card>
          </section>

          <section>
            <SectionLabel style={{ marginBottom: "8px" }}>数据</SectionLabel>
            <Card>
              <SettingRow
                label="配置导入 / 导出"
                hint="导出文件包含明文凭证，请妥善保管"
                style={NO_BORDER}
              >
                <Btn>导入</Btn>
                <Btn>导出</Btn>
                <Btn variant="danger">清除本地缓存</Btn>
              </SettingRow>
            </Card>
          </section>

          <section>
            <SectionLabel style={{ marginBottom: "8px" }}>设计参考</SectionLabel>
            <Card>
              <SettingRow
                label="协议能力矩阵 · 复用策略 · 导航模型"
                hint="设计稿 3h / 4d / 5c，说明各页面按协议如何裁剪"
                style={NO_BORDER}
              >
                <Btn onClick={() => onOpenDoc?.("capability")}>能力矩阵</Btn>
                <Btn onClick={() => onOpenDoc?.("reuse")}>复用策略</Btn>
                <Btn onClick={() => onOpenDoc?.("nav")}>导航模型</Btn>
              </SettingRow>
            </Card>
          </section>

          <section>
            <SectionLabel style={{ marginBottom: "8px" }}>关于</SectionLabel>
            <Card>
              <SettingRow
                label="MQ Studio v0.2.0"
                hint={
                  <>
                    Apache-2.0 · 已是最新版本 · <span style={{ color: "#0b64f4" }}>GitHub ↗</span>
                  </>
                }
                style={NO_BORDER}
              >
                <Btn>检查更新</Btn>
              </SettingRow>
            </Card>
          </section>
        </div>
      </div>
    </Page>
  );
}
