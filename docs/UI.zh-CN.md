# 界面设计原则

MQ Studio 的界面怎么搭、应该长什么样。新增页面、对话框或组件之前先读这一篇。[English](UI.md)

## 每类需求只用一个库

| 需求 | 使用 | 位置 |
| --- | --- | --- |
| 组件 | [shadcn/ui](https://ui.shadcn.com)，风格 **Nova**（`radix-nova`） | `frontend/src/components/ui` |
| 图标 | [Lucide](https://lucide.dev)（`lucide-react`） | 全部 |
| 动画 | [Motion](https://motion.dev)（`motion/react`） | 进场、退场与布局变化 |
| 可拖拽调整的布局 | [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)，经 shadcn `Resizable` | 分栏、AI 助手侧栏 |
| 拖拽排序 | [dnd-kit](https://dndkit.com) | 一切需要拖动排序的地方 |
| 共享状态 | [Zustand](https://zustand.docs.pmnd.rs) | 跨组件、又不属于某个 Provider 的状态 |
| 图表 | Recharts，经 shadcn `Chart` | 时间序列、分布 |
| 通知 / 命令面板 | sonner / cmdk，均经 shadcn | — |

**已有依赖能正确表达的组件和行为，严禁自己设计实现。**手写的下拉菜单、提示框、可拖拽分栏、退场动画、可排序列表，维护成本远高于省下的那点工夫。只有在列出的库都无法表达需求时才自己写，并在代码注释里写明原因。

以下例外各有原因：

- **品牌标志**（协议 Logo、GitHub、操作系统图标）来自 `react-icons`（Simple Icons、Font Awesome 品牌图标）：Lucide 不提供品牌图标。
- **详情面板**（`DetailPanel`）不是 shadcn 的 `Sheet`：它是非模态的、停靠在列表旁边，点击另一行可以直接切换内容。它的动画同样用 Motion。
- **消息体编辑器**是叠在高亮副本上的 textarea；上面列出的库没有文本编辑能力。

### 添加 shadcn 组件

在 `frontend/` 下运行 `npx shadcn@latest add <name>`。CLI 会把 `cn` 工具函数解析成 npm 上一个同名的 `cn` 包：撤销它对 `package.json` 的改动，改为从 `@/lib/utils` 引入 `cn`。导出列表只保留应用用到的部分（`tsc` 开启了 `noUnusedLocals`）。基础组件就地调整；应用专用的组合放在 `frontend/src/components` 下。

## 视觉语言

**分层。**标题栏和侧边栏放在底面（`--c-chrome`）上；页面是一张铺在底面上的白页（`.mqs-content`），四周留 8px，圆角 10px。导航在底面上，内容在白页上。

**色彩。**中性色是取自 Logo 纸色与墨色的暖石色阶；唯一的操作色是钴蓝（`--c-primary`），用于主按钮、当前页面、选中行、勾选框、开关、链接和图表的第一条序列。状态色（`--c-ok`、`--c-warn`、`--c-err`）只表示状态。图标底块从 `--c-tone-*` 中取色，这组色相刻意避开状态色。品牌红只属于 Logo。所有颜色都是 `design/tokens.css` 里的 token 且都有暗色值，不要写只在一种底色上成立的字面色值。

**字体。**系统界面字体，根字号 13px：正文与表格 12.5px（`text-sm`），标签与辅助信息 11-11.5px，卡片标题 13px 半粗，页面标题 16px 半粗。数字一律 `tabular-nums`。等宽字体只用于标识符（地址、消息 ID、位点、消息体）；Topic、消费组、队列这类名字用界面字体，并保持可选中复制。

**密度。**这是桌面工具：控件高 26-29px，表格行约 34px，卡片内边距 16px。用留白和一条细线来分组，不要框里套框。

## 页面模式

- **页头与筛选行。**`PageHeader`（标题、副标题、操作）下面接 `Toolbar`；分隔线放在筛选行下面，而不是两者之间。
- **列表 + 详情面板。**`ListArea` > `ListPane` + `DetailPanel`。面板放在行的旁边，列表让出它的宽度，不会有列被遮住；页面较窄时改为覆盖。
- **总览。**一张分格 KPI 卡（`.mqs-kpis` + 带图标和色调的 `StatTile`），图例放在卡片标题栏里的图表，然后是并排的排行表，各自链接到完整页面。
- **按名字辨认的对象集合**（连接）用卡片宫格，并提供列表视图；**需要逐行扫读、比较的数据**（Topic、消费组、消息）用表格。
- **对话框**里每个标签都放在全宽控件上方，标题、标签、控件和底部按钮共用同一条左右边线。
- **危险操作**一律用 `variant="destructive"`（Nova 的浅红），发起的按钮和确认的按钮都一样；起保护作用的是确认框，而不是更重的颜色。

## 动画

凡是进场、退场或布局变化都用 Motion：退场用 `AnimatePresence`，进场用 `motion.*`，重排用 `layout`。时长和曲线取自 `lib/motion.ts`（`DURATION`、`EASE`，以及 `viewIn`、`reveal` 等预设），它们与 `--mo-*` 变量一一对应：简短（120-280ms），进场用减速曲线。详情面板无需额外处理，`ListArea` 已经负责它的退场。鼠标悬停时颜色或边框的变化可以用 CSS transition，shadcn 的浮层沿用它们自带的动画。设置里的“界面过渡动画”会关闭全部动画：CSS 变量归零，`setAnimations` 让 Motion 直接跳到终态。
