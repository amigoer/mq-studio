SHELL := /bin/sh
.DEFAULT_GOAL := help
.NOTPARALLEL:

# Optional cross-compilation parameters, for example: make build-daemon TARGET_OS=linux TARGET_ARCH=arm64
TARGET_OS ?=
TARGET_ARCH ?=

.PHONY: help install install-ci generate icons dev run \
	build build-daemon build-daemon-all build-desktop package \
	test test-go test-desktop test-smoke test-e2e test-all \
	e2e e2e-up e2e-down check ci clean

help: ## Show all available targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_.-]+:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install root and Electron desktop dependencies
	npm install
	npm install --prefix desktop

install-ci: ## Install dependencies from lockfiles (CI)
	npm ci
	npm ci --prefix desktop

generate: ## Generate desktop TypeScript types from OpenAPI
	npm run generate:api

icons: ## Generate PNG, ICNS, and ICO icons with platform-safe padding from the source image
	sh scripts/generate-icons.sh

dev: ## Start the Electron development environment and Go daemon
	sh scripts/run-electron.sh dev

run: build ## Build and run the Electron app temporarily, leaving no app process after exit
	sh scripts/run-electron.sh run

build: build-daemon build-desktop ## Build the daemon and Electron app for the current platform

build-daemon: ## Build the daemon; TARGET_OS and TARGET_ARCH are optional
	sh scripts/build-daemon.sh $(TARGET_OS) $(TARGET_ARCH)

build-daemon-all: ## Build x64 and arm64 daemons for macOS, Windows, and Linux
	@for os in mac win linux; do \
		for arch in x64 arm64; do \
			sh scripts/build-daemon.sh $$os $$arch; \
		done; \
	done

build-desktop: ## Type-check and build the Electron Main, Preload, and Renderer processes
	npm run build:desktop

package: ## Build an internal test installer for the current platform
	sh scripts/package.sh

test: ## Run Go and desktop unit tests plus the daemon smoke test
	npm test

test-go: ## Run all Go tests
	npm run test:go

test-desktop: ## Run Electron Main and Renderer unit tests
	npm run test:desktop

test-smoke: ## Run the daemon startup, authentication, and shutdown smoke test
	npm run test:daemon-smoke

test-e2e: ## Run Electron end-to-end tests against a running RocketMQ instance
	npm run test:e2e

e2e-up: ## Start RocketMQ 5.3.2 with OrbStack or Docker
	npm run e2e:up

e2e-down: ## Stop the RocketMQ E2E environment and remove test volumes
	npm run e2e:down

e2e: ## Start RocketMQ, run E2E tests, and clean up automatically
	@set -eu; \
		cleanup() { \
			trap - EXIT INT TERM; \
			$(MAKE) --no-print-directory e2e-down; \
		}; \
		trap cleanup EXIT INT TERM; \
		$(MAKE) --no-print-directory e2e-up; \
		$(MAKE) --no-print-directory test-e2e

test-all: test e2e ## Run unit, smoke, and full end-to-end tests

check: ## Run Go vet, type checks, tests, and OpenAPI drift checks
	npm run check

ci: install-ci check ## Run baseline CI checks without Docker E2E tests

clean: ## Remove daemon, Electron, and installer build artifacts
	rm -rf daemon/dist desktop/out desktop/resources/bin release
