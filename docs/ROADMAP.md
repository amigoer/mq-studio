# Rocket-Leaf 路线图

本文档反映 **当前实现状态** 与后续规划。已完成项以代码中的服务与 `frontend/src/redesign/screens` 为准。

---

## 总览

| 阶段 | 名称       | 核心目标                             |             状态              |
| :--: | ---------- | ------------------------------------ | :---------------------------: |
|  1   | 基础框架   | Wails + React UI、主题、i18n、壳布局 |           ✅ 已完成           |
|  2   | 连接管理   | 多集群连接、持久化、加密、默认连接   |           ✅ 已完成           |
|  3   | Topic 管理 | 列表/详情/路由、增删改、统计         |           ✅ 已完成           |
|  4   | 消费者组   | 列表/详情、进度、重置 Offset、组配置 |           ✅ 已完成           |
|  5   | 消息管理   | 查询、详情、轨迹、发送、DLQ/Retry    |           ✅ 已完成           |
|  6   | 集群与监控 | 集群/Broker 指标、吞吐、本地告警     | ✅ 已完成（告警为客户端规则） |
|  7   | ACL        | 访问配置与全局白名单                 |     ✅ 已完成（基础能力）     |
|  —   | 增强项     | 规则引擎告警、测试体系、插件等       |           📋 规划中           |

---

## Phase 1: 基础框架 ✅

**目标**：桌面壳与主界面骨架。

- [x] Wails v3 + Go 后端 + 前端资源嵌入
- [x] React 18 + TypeScript + Vite
- [x] Tailwind CSS 与设计样式（`index.css` / `design.css`）
- [x] 主体布局：自定义 TitleBar、Sidebar、主内容区
- [x] 主题：`system` / `light` / `dark`
- [x] 国际化：中 / 英（i18next）
- [x] Overview 首页与未连接空状态

**实现位置**：`main.go`、`frontend/src/App.tsx`、`redesign/*`、`hooks/useSettings`、`hooks/useUIPrefs`、`i18n/`

---

## Phase 2: 连接管理 ✅

**目标**：RocketMQ 连接配置与生命周期。

- [x] 连接表单：名称、环境、NameServer、超时、ACL 凭证、备注
- [x] 列表：添加 / 编辑 / 删除 / 设为默认
- [x] 测试连接、连接 / 断开、在线状态
- [x] 默认连接与业务侧懒初始化
- [x] 启动自动连接、多 NameServer（`;`、`,` 或空白分隔）与客户端原子替换
- [x] 本地 `connections.json` 持久化
- [x] AccessKey / SecretKey AES-256-GCM 加密
- [x] 全量配置跨设备导出、原子导入回滚与运行时热加载

**实现位置**：`internal/service/connection_service.go`、`internal/crypto`、`redesign/screens/ConnectionsScreen.tsx`

---

## Phase 3: Topic 管理 ✅

**目标**：Topic 查看与运维操作。

- [x] 列表、搜索/过滤
- [x] 详情与路由信息
- [x] 创建 / 更新 / 删除
- [x] 统计（Offset 等，经 Admin API）

**实现位置**：`internal/service/topic_service.go`、`redesign/screens/TopicsScreen.tsx`

---

## Phase 4: 消费者组管理 ✅

**目标**：消费组查看与进度管理。

- [x] 组列表、在线/离线等状态信息
- [x] 详情、订阅与消费统计
- [x] 客户端列表
- [x] 按时间重置 Offset
- [x] 创建 / 更新 / 删除订阅组配置（按 Broker）

**实现位置**：`internal/service/consumer_service.go`、`redesign/screens/ConsumersScreen.tsx`

---

## Phase 5: 消息管理 ✅

**目标**：查询、发送与问题排查。

- [x] 按 Topic + 时间范围 / Key / Tag 查询
- [x] 按 Message ID 精确查询
- [x] 消息详情与属性
- [x] 消息轨迹
- [x] 发送测试消息（Tag / Key / Body / 延时级别）
- [x] 重发、DLQ / Retry 查询
- [x] 独立 Producer 页面

**实现位置**：`internal/service/message_service.go`、`MessagesScreen`、`ProducerScreen`

---

## Phase 6: 集群与监控 ✅

**目标**：集群健康与吞吐可见性。

- [x] 集群信息、Broker 列表、NameServer
- [x] Broker 运行时指标（含磁盘等 enrichment）
- [x] 生产/消费 TPS 与历史采样（Overview / Cluster）
- [x] 消费堆积汇总
- [x] Alerts 页：基于阈值的本地告警（如 lag、磁盘），非服务端推送

**实现位置**：`internal/service/cluster_service.go`、`ClusterScreen`、`OverviewScreen`、`AlertsScreen`、`settings.lagAlertThreshold`

**已知边界**：

- 告警为客户端派生规则，无通知通道（邮件/Webhook 等）
- 无独立时序数据库；TPS 历史为进程内采样窗口

---

## Phase 7: ACL ✅

**目标**：集群 ACL 基础运维。

- [x] 查询 ACL 是否启用及版本信息
- [x] 创建/更新 AccessConfig
- [x] 删除 AccessConfig
- [x] 更新全局白名单（前端危险操作确认）

**实现位置**：`internal/service/acl_service.go`、`AclScreen`

**已知边界**：能力依赖 Broker 侧 ACL 支持；部分旧版本接口会按「不支持」降级处理。

---

## 后续规划 📋

按优先级大致排序（可随需求调整）：

### 产品

- [ ] 告警规则可配置（多阈值、启停、持久化规则）
- [ ] 外部通知（Webhook / 系统通知等）
- [ ] 死信批量处理与可视化工作流增强
- [ ] 多连接并行监控（当前以默认/在线连接为主）
- [ ] 消息体更多格式预览与大消息策略优化

### 工程

- [x] 后端关键单测起步（crypto、连接 ACL/多 NameServer、配置导入、消息键与队列键解析）
- [ ] 后端 service 更全面单测与 Admin mock
- [ ] 前端关键路径测试（连接门禁、错误 toast 等）
- [x] 清理 redesign 前历史 `*View` UI（已删除）
- [ ] 文档与 CI 对「仅 amd64/arm64、无 universal」等发布矩阵的持续对齐
- [x] 设置项诚实化：全局 ACL 凭证回退已接线；代理/TLS 在 UI 标明暂未支持
- [x] 消息时区/时间格式/大消息截断按设置生效
- [x] 检查更新对比 GitHub latest release
- [x] Topic 详情订阅组列表；ACL 写入型能力说明；告警规则本机启停

### 探索（未排期）

- 历史指标落盘与报表
- 插件化扩展
- 移动端（`build/ios`、`build/android` 脚手架存在，非当前主交付）

---

## 贡献

欢迎提交 Issue 与 Pull Request。技术栈与目录说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

变更功能范围时，请同步更新本文件中的勾选状态与「已知边界」。
