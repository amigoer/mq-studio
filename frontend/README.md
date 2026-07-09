# Frontend

Rocket-Leaf 桌面端界面：**React 18 + TypeScript + Vite + Tailwind CSS 4**。

通过 Wails v3 与 Go 后端通信：运行时使用 `@wailsio/runtime`，业务调用使用生成的 `bindings/`。

## 技术栈

| 依赖                    | 用途                  |
| ----------------------- | --------------------- |
| React 18                | UI                    |
| TypeScript              | 类型                  |
| Vite 7                  | 开发与构建            |
| Tailwind CSS 4          | 样式                  |
| i18next                 | 中/英                 |
| recharts                | 图表                  |
| sonner                  | Toast                 |
| lucide-react            | 图标                  |
| Radix / shadcn 风格组件 | `src/components/ui/*` |
| @wailsio/runtime        | 窗口、打开链接等      |

## 目录

```
src/
├── main.tsx              # 入口（Settings / Connections Provider）
├── App.tsx               # 壳：TitleBar + Sidebar + 页面状态切换
├── api/                  # 对 Wails bindings 的薄封装
├── hooks/                # 数据与偏好（Context / hooks）
├── redesign/             # 当前主 UI（请优先改这里）
│   ├── TitleBar.tsx
│   ├── Sidebar.tsx
│   ├── shell.tsx
│   └── screens/          # Overview、Topics、Consumers、Messages…
├── components/           # 通用组件；部分 *View 为历史实现
├── i18n/                 # en.json / zh.json
├── lib/utils.ts
└── index.css / design.css
```

完整应用架构见仓库根目录 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。

## 开发

桌面联调（推荐，与 Go / Wails 一起跑）：

```sh
# 在仓库根目录
task dev
```

仅前端（无 Go 绑定能力时，依赖后端的接口会失败）：

```sh
npm install
npm run dev
```

## 构建

```sh
npm run build          # tsc + vite build → dist/
npm run build:dev      # 开发模式构建（不 minify）
npm run type-check     # 仅类型检查
```

`dist/` 由 `main.go` 通过 `//go:embed all:frontend/dist` 嵌入二进制。

## 调用后端

1. Go 在 `internal/service` 导出方法，并在 `main.go` 注册为 Wails Service
2. Wails 生成 `bindings/rocket-leaf/internal/service/*`
3. `src/api/*` 封装调用；Screen / hooks 使用 api 层

不要在业务代码里绕过 `api/` 直接散落修改生成物逻辑；生成绑定更新后以新 bindings 为准。

## 约定

- **主 UI**：`src/redesign/`
- **导航**：`App.tsx` 中 `activeNav`，无 React Router
- **文案**：走 i18n，避免硬编码用户可见字符串
- **错误提示**：统一 `formatErrorMessage` + sonner toast
