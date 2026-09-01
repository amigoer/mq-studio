#!/usr/bin/env bash
#
# Seeds the Pulsar E2E environment with a topology worth cross-checking.
#
# Unlike the RocketMQ seed, nothing here is required: every live test creates
# and removes what it needs, because a suite that depends on a seed fails
# differently depending on whether somebody ran it. What this is for is the
# cross-check, which compares figures the app computes against the same figures
# from Pulsar's own CLI - and comparing zero against zero proves nothing.
#
# Idempotent: run it as often as you like.
set -euo pipefail

CONTAINER="${PULSAR_CONTAINER:-mq-studio-e2e-pulsar-pulsar-1}"
TENANT="mq-studio-seed"
NAMESPACE="$TENANT/orders"
CLUSTER="standalone"

admin() {
  docker exec "$CONTAINER" bin/pulsar-admin "$@"
}

# pulsar-admin has no produce subcommand in 4.x; pulsar-client is the tool that
# publishes, and it is a separate binary with its own arguments.
produce() {
  docker exec "$CONTAINER" bin/pulsar-client produce "$1" -m "$2" -n "${3:-1}"
}

# Best effort throughout: every object may already exist from a previous run,
# and "already exists" is success as far as seeding is concerned.
try() {
  "$@" >/dev/null 2>&1 || true
}

echo "seeding pulsar in $CONTAINER"

try admin tenants create "$TENANT" --allowed-clusters "$CLUSTER"
try admin namespaces create "$NAMESPACE"

# A namespace policy, so the namespaces page has something other than defaults
# to show and the cross-check has a value to compare.
try admin namespaces set-message-ttl "$NAMESPACE" --messageTTL 3600
try admin namespaces set-retention "$NAMESPACE" --size 512M --time 60m

# Both topic shapes. They answer at different endpoints - a non-partitioned
# topic returns 404 from partitioned-stats - so a seed with only one of them
# would leave half the driver uncovered.
try admin topics create-partitioned-topic "persistent://$NAMESPACE/orders" --partitions 3
try admin topics create "persistent://$NAMESPACE/audit"
try admin topics create "non-persistent://$NAMESPACE/telemetry"

# The dead-letter naming convention, spelled out the way the client libraries
# spell it. Nothing on the broker records the link, so the seed is what gives
# the cross-check a source to resolve - and an orphan, whose origin topic does
# not exist, is the row the page most needs to get right.
try admin topics create "persistent://$NAMESPACE/orders-worker-DLQ"
try admin topics create "persistent://$NAMESPACE/orders-worker-RETRY"
try admin topics create "persistent://$NAMESPACE/gone-reader-DLQ"

# Subscriptions created before anything is published, so every message below
# lands in their backlog. A backlog is what the consumer page is read for, and
# an empty one would make the cross-check compare zero against zero.
try admin topics create-subscription "persistent://$NAMESPACE/orders" -s worker
try admin topics create-subscription "persistent://$NAMESPACE/orders" -s archive
try admin topics create-subscription "persistent://$NAMESPACE/audit" -s slow
try admin topics create-subscription "persistent://$NAMESPACE/orders-worker-DLQ" -s cleanup

# Nothing consumes these, so they stay in the backlog.
try produce "persistent://$NAMESPACE/orders" "seeded" 5
try produce "persistent://$NAMESPACE/audit" "audited" 2
try produce "persistent://$NAMESPACE/orders-worker-DLQ" "gave-up" 3

# A role grant, so the tokens page has a row. The role need not exist: Pulsar
# authorises the subject of a token and keeps no directory of them.
try admin namespaces grant-permission "$NAMESPACE" --role seeded-reader --actions consume

echo "seeded: $NAMESPACE"
admin topics list "$NAMESPACE" || true
