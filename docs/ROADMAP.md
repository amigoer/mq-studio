# Rocket-Leaf 路线图

本文档反映 **当前实现状态** 与后续规划。已完成项以代码中的服务与 `frontend/src/redesign/screens` 为准。

**最近对齐版本**：v1.3.x（UI 重设计、配置导入导出、精简 Release 产物、告警阈值与系统通知、消息体预览模式）。

---

## 总览

| 阶段 | 名称       | 核心目标                             |  状态  |
| :--: | ---------- | ------------------------------------ | :----: |
|  1   | 基础框架   | Wails + React UI、主题、i18n、壳布局 |   ✅   |
|  2   | 连接管理   | 多集群连接、持久化、加密、默认连接   |   ✅   |
|  3   | Topic 管理 | 列表/详情/路由、增删改、统计         |   ✅   |
|  4   | 消费者组   | 列表/详情、进度、重置 Offset、组配置 |   ✅   |
|  5   | 消息管理   | 查询、详情、轨迹、发送、DLQ/Retry    |   ✅   |
|  6   | 集群与监控 | 集群/Broker 指标、吞吐、本地告警     |   ✅   |
|  7   | ACL        | 访问配置与全局白名单                 |   ✅   |
|  —   | 增强项     | 见下文「已完成增强」与「后续规划」   | 进行中 |

---

## Phase 1–7（核心交付）✅

### Phase 1: 基础框架

- [x] Wails v3 + Go 后端 + 前端资源嵌入
- [x] React 18 + TypeScript + Vite + Tailwind / design.css
- [x] TitleBar、Sidebar、主内容区与页面过渡
- [x] 主题 system / light / dark；中英 i18n
- [x] Overview 与未连接空状态（含前往连接 CTA）

### Phase 2: 连接管理

- [x] 连接 CRUD、默认连接、测试 / 连接 / 断开
- [x] 启动自动连接、多 NameServer 解析
- [x] 本地加密持久化、全量配置原子导入导出与热重载

### Phase 3: Topic

- [x] 列表、搜索/过滤、详情与路由、增删改、统计

### Phase 4: 消费者组

- [x] 列表与状态、详情、客户端、按时间重置 Offset、组配置 CRUD

### Phase 5: 消息

- [x] 条件查询、MessageId、轨迹、重发、DLQ/Retry、Producer 页
- [x] 最新优先时间窗扫描；消息体截断与 JSON 美化
- [x] 消息体预览模式：自动 / 原文 / 十六进制（含类型探测）

### Phase 6: 集群与监控

- [x] 集群 / Broker / NameServer、TPS 采样、堆积汇总
- [x] Alerts：规则启停（本机）、堆积与磁盘阈值（设置项）、桌面系统通知（可选）

### Phase 7: ACL

- [x] 启用状态、AccessConfig 写操作、全局白名单（危险操作确认）
- [x] 旧版 Broker 不支持接口的降级处理

---

## 已完成增强（相对早期路线图）

产品 / 体验：

- [x] 告警规则本机启停 + 堆积 / 磁盘阈值可配置（设置中持久化）
- [x] 可选桌面通知（新告警出现时；需系统授权）
- [x] 设置项诚实化：全局 ACL 凭证回退；代理 / TLS 在 UI 标明未支持
- [x] 检查更新对比 GitHub latest release
- [x] Release 仅发布 6 个用户安装包（macOS app.zip / Windows installer / Linux AppImage）
- [x] README 下载矩阵与安装说明对齐 CI

工程：

- [x] 后端关键单测：crypto、连接、配置导入、消息键 / 队列键等
- [x] redesign 前历史 `*View` UI 已清理
- [x] 文档与发布矩阵（仅 amd64/arm64，无 universal）对齐

---

## 已知边界

| 领域     | 说明                                                        |
| -------- | ----------------------------------------------------------- |
| 告警     | 客户端派生规则；无邮件 / Webhook 通道；TPS 历史为进程内窗口 |
| ACL      | 依赖 Broker Plain ACL；4.x 无列表 API，页为写入型运维       |
| 连接     | 业务以当前在线（默认）连接为主，非多集群并行仪表盘          |
| 网络     | HTTP 代理、跳过 TLS 未接入 Admin 客户端                     |
| Linux 包 | AppImage 自带 WebKit/GTK，体积较大、CI 较慢（可移植代价）   |

---

## 后续规划

按优先级大致排序，可随需求调整。

### 产品（未做）

- [ ] 外部通知通道（Webhook / 邮件等）
- [ ] 死信批量处理与更完整工作流
- [ ] 多连接并行监控仪表盘
- [ ] 消息体更多结构化预览（如 Protobuf schema、压缩 payload 解压）

### 工程（未做）

- [ ] 后端 service 层更全面单测 + Admin mock
- [ ] 前端关键路径测试（连接门禁、toast、告警规则）
- [ ] Linux 打包仅编 AppImage、加强 Docker 缓存以缩短 CI（可选优化）

### 探索（未排期）

- 历史指标落盘与报表
- 插件化扩展
- 移动端（`build/ios`、`build/android` 脚手架存在，非主交付）

---

## 贡献

欢迎提交 Issue 与 Pull Request。技术栈与目录说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

变更功能范围时，请同步更新本文件中的勾选状态与「已知边界」。
