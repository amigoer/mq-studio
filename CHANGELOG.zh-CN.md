# 更新日志

本文件记录 MQ Studio 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

[English](CHANGELOG.md)

## [未发布]

## [0.0.1] - 2026-08-31

重构后的第一个版本。

### 新增

- 应用围绕驱动端口重新组织：一种消息中间件就是一个驱动，实现同一套接口；界面根据
  连接上的端点报告自己能做什么来绘制。
- 支持 RocketMQ 4.x 与 5.x。

### 说明

- 目前只有 RocketMQ 可以连接，其余协议在界面上呈现但禁用。
- 版本号从这里重新开始。0.1.x 那几个构建早于这次重构，已经删除。
