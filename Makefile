SHELL := /bin/sh
.DEFAULT_GOAL := help
.NOTPARALLEL:

# Optional cross-compilation target, for example: make build ARCH=amd64
ARCH ?=

.PHONY: help install install-ci bindings icons dev run build package dmg \
	test test-go test-frontend e2e e2e-up e2e-seed e2e-down \
	e2e-acl-up e2e-acl-down \
	e2e-rabbitmq-up e2e-rabbitmq-seed e2e-rabbitmq-down \
	e2e-rabbitmq-plain-up e2e-rabbitmq-plain-down \
	e2e-kafka-up e2e-kafka-seed e2e-kafka-down \
	e2e-kafka-secure-up e2e-kafka-secure-down \
	e2e-redis-up e2e-redis-seed e2e-redis-down \
	e2e-redis-cluster-up e2e-redis-cluster-down \
	check ci clean \
	website-dev website-build

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

e2e-seed: ## Seed the E2E broker with the topic and consumer group the live tests need
	npm run e2e:seed

e2e-acl-up: ## Start the ACL-enabled RocketMQ used by the ACL live tests
	npm run e2e:acl:up

e2e-acl-down: ## Stop the ACL E2E environment and remove its volumes
	npm run e2e:acl:down

e2e-rabbitmq-up: ## Start RabbitMQ 4 with the shovel, federation and stream plugins on
	npm run e2e:rabbitmq:up

e2e-rabbitmq-seed: ## Seed the RabbitMQ E2E broker with a topology worth looking at
	npm run e2e:rabbitmq:seed

e2e-rabbitmq-down: ## Stop the RabbitMQ E2E environment and remove its volumes
	npm run e2e:rabbitmq:down

e2e-rabbitmq-plain-up: ## Start the plugin-free RabbitMQ used by the degraded-path tests
	npm run e2e:rabbitmq:plain:up

e2e-rabbitmq-plain-down: ## Stop the plugin-free RabbitMQ environment
	npm run e2e:rabbitmq:plain:down

e2e-kafka-up: ## Start the three-broker KRaft Kafka cluster the live tests use
	npm run e2e:kafka:up

e2e-kafka-seed: ## Seed the Kafka cluster with topics, records and consumer groups
	npm run e2e:kafka:seed

e2e-kafka-down: ## Stop the Kafka E2E cluster and remove its volumes
	npm run e2e:kafka:down

e2e-kafka-secure-up: ## Start the SASL and authorizer Kafka used by the access-control tests
	npm run e2e:kafka:secure:up

e2e-kafka-secure-down: ## Stop the secure Kafka environment
	npm run e2e:kafka:secure:down

e2e-redis-up: ## Start the ACL-enabled Redis the live tests use
	npm run e2e:redis:up

e2e-redis-seed: ## Seed Redis with streams, groups and a pending entries list
	npm run e2e:redis:seed

e2e-redis-down: ## Stop the Redis environment and remove its volumes
	npm run e2e:redis:down

e2e-redis-cluster-up: ## Start the six-node Redis cluster used by the cluster tests
	npm run e2e:redis:cluster:up

e2e-redis-cluster-down: ## Stop the Redis cluster environment
	npm run e2e:redis:cluster:down

e2e: ## Run the live tests against a running, seeded RocketMQ E2E environment
	npm run test:e2e

e2e-down: ## Stop the RocketMQ E2E environment and remove test volumes
	npm run e2e:down

website-dev: ## Run the marketing site with hot reload
	npm run website:dev

website-build: ## Build the marketing site into website/out
	npm run website:build

check: ## Run version, frontend build, gofmt, vet, tests, and bindings drift checks
	npm run check

ci: install-ci check ## Run baseline CI checks without Docker

clean: ## Remove build artifacts
	rm -rf bin frontend/dist
