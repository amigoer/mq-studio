SHELL := /bin/sh
.DEFAULT_GOAL := help
.NOTPARALLEL:

# 可选交叉编译参数，例如：make build-daemon TARGET_OS=linux TARGET_ARCH=arm64
TARGET_OS ?=
TARGET_ARCH ?=

.PHONY: help install install-ci generate icons dev run \
	build build-daemon build-daemon-all build-desktop package \
	test test-go test-desktop test-smoke test-e2e test-all \
	e2e e2e-up e2e-down check ci clean

help: ## 显示所有可用目标
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_.-]+:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## 安装根目录与 Electron 桌面端依赖
	npm install
	npm install --prefix desktop

install-ci: ## 使用锁文件安装依赖（CI）
	npm ci
	npm ci --prefix desktop

generate: ## 根据 OpenAPI 生成桌面端 TypeScript 类型
	npm run generate:api

icons: ## 从主图生成带平台安全边距的 PNG、ICNS 与 ICO 图标
	sh scripts/generate-icons.sh

dev: ## 启动 Electron 开发环境与 Go daemon
	sh scripts/run-electron.sh dev

run: build ## 构建并临时运行 Electron 应用，退出后不保留应用进程
	sh scripts/run-electron.sh run

build: build-daemon build-desktop ## 构建当前平台 daemon 与 Electron

build-daemon: ## 构建 daemon；可传 TARGET_OS 与 TARGET_ARCH
	sh scripts/build-daemon.sh $(TARGET_OS) $(TARGET_ARCH)

build-daemon-all: ## 构建 macOS、Windows、Linux 的 x64/arm64 daemon
	@for os in mac win linux; do \
		for arch in x64 arm64; do \
			sh scripts/build-daemon.sh $$os $$arch; \
		done; \
	done

build-desktop: ## 类型检查并构建 Electron Main、Preload 与 Renderer
	npm run build:desktop

package: ## 构建当前平台内部测试安装包
	sh scripts/package.sh

test: ## 运行 Go、桌面端单元测试及 daemon 冒烟测试
	npm test

test-go: ## 运行全部 Go 测试
	npm run test:go

test-desktop: ## 运行 Electron Main 与 Renderer 单元测试
	npm run test:desktop

test-smoke: ## 运行 daemon 启动、鉴权和退出冒烟测试
	npm run test:daemon-smoke

test-e2e: ## 对已运行的 RocketMQ 执行 Electron 端到端测试
	npm run test:e2e

e2e-up: ## 使用 OrbStack/Docker 启动 RocketMQ 5.3.2
	npm run e2e:up

e2e-down: ## 停止 RocketMQ E2E 环境并删除测试卷
	npm run e2e:down

e2e: ## 启动 RocketMQ、执行 E2E，并在结束后自动清理
	@set -eu; \
		cleanup() { \
			trap - EXIT INT TERM; \
			$(MAKE) --no-print-directory e2e-down; \
		}; \
		trap cleanup EXIT INT TERM; \
		$(MAKE) --no-print-directory e2e-up; \
		$(MAKE) --no-print-directory test-e2e

test-all: test e2e ## 运行单元、冒烟和完整端到端测试

check: ## 运行 Go vet、类型、测试与 OpenAPI 漂移检查
	npm run check

ci: install-ci check ## 执行不含 Docker E2E 的 CI 基础检查

clean: ## 删除 daemon、Electron 与安装包构建产物
	rm -rf daemon/dist desktop/out desktop/resources/bin release
