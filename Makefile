SHELL := /bin/sh
.DEFAULT_GOAL := help
.NOTPARALLEL:

# Optional cross-compilation target, for example: make build ARCH=amd64
ARCH ?=

.PHONY: help install install-ci bindings icons dev run build package dmg \
	test test-go test-frontend e2e e2e-up e2e-down check ci clean

help: ## Show all available targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-zA-Z0-9_.-]+:.*## / { printf "  %-20s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install root and frontend dependencies
	npm install
	npm install --prefix frontend

install-ci: ## Install dependencies from lockfiles (CI)
	npm ci
	npm ci --prefix frontend

bindings: ## Regenerate the TypeScript bindings from the Go services
	npm run generate:bindings

icons: ## Regenerate platform icons from build/appicon.png
	wails3 task icons

dev: ## Run the app with frontend hot reload
	wails3 task dev

run: ## Build and run the app
	wails3 task run

build: ## Build the app for the current platform
	wails3 task build $(if $(ARCH),ARCH=$(ARCH),)

package: ## Package a distributable build for the current platform
	wails3 task package $(if $(ARCH),ARCH=$(ARCH),)

dmg: ## Build the macOS disk image (needs: pipx install dmgbuild)
	wails3 task darwin:package:dmg $(if $(ARCH),ARCH=$(ARCH),)

test: ## Run Go and frontend unit tests
	npm test

test-go: ## Run all Go tests
	npm run test:go

test-frontend: ## Run frontend unit tests
	npm run test:frontend

e2e-up: ## Start RocketMQ 5.3.2 with OrbStack or Docker
	npm run e2e:up

e2e-down: ## Stop the RocketMQ E2E environment and remove test volumes
	npm run e2e:down

check: ## Run version, frontend build, gofmt, vet, tests, and bindings drift checks
	npm run check

ci: install-ci check ## Run baseline CI checks without Docker

clean: ## Remove build artifacts
	rm -rf bin frontend/dist
