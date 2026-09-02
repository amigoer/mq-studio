#!/usr/bin/env bash
#
# Seeds the Pulsar E2E environment with a topology worth cross-checking.
#
# Unlike the RocketMQ seed, nothing here is required by the live tests: every
# one of them creates and removes what it needs, because a suite that depends
# on a seed fails differently depending on whether somebody ran it. What this
# is for is the cross-check, which compares figures the app computes against
# the same figures from Pulsar's own CLI - and comparing zero against zero
# proves nothing.
#
# Every bin/pulsar-admin call is a fresh JVM, which is the whole cost of this
# script: twenty of them in series took over two minutes of every CI run. They
# are grouped into layers below instead - within a layer nothing depends on
# anything else, so the layer costs one JVM start rather than one each.
#
# Idempotent: run it as often as you like. The message counts grow, which the
# cross-check does not mind - it compares the app and the CLI at one moment,
# not against a fixed number.
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
# and "already exists" is success as far as seeding is concerned. What this
# used to hide is that a seed which failed outright looked identical - so the
# verification at the bottom is what now decides whether this worked.
try() {
  "$@" >/dev/null 2>&1 || true
}

pids=()

# Adds a command to the current layer. Nothing in a layer may depend on
# anything else in it.
spawn() {
  try "$@" &
  pids+=("$!")
}

# Closes the layer. try never fails, so this only waits.
await() {
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do
    wait "$pid" || true
  done
  pids=()
}

echo "seeding pulsar in $CONTAINER"

# Layer 1-2: the tenant, then the namespace inside it.
try admin tenants create "$TENANT" --allowed-clusters "$CLUSTER"
try admin namespaces create "$NAMESPACE"

# Layer 3: everything that needs only the namespace.
#
# The TTL is a day rather than an hour because it applies to the seeded
# messages too: a short one expires the backlog the cross-check is comparing
# against, and the suite then fails with "no backlog" for anyone who seeded a
# while ago.
spawn admin namespaces set-message-ttl "$NAMESPACE" --messageTTL 86400
spawn admin namespaces set-retention "$NAMESPACE" --size 512M --time 60m

# A role grant, so the tokens page has a row. The role need not exist: Pulsar
# authorises the subject of a token and keeps no directory of them.
spawn admin namespaces grant-permission "$NAMESPACE" --role seeded-reader --actions consume

# Both topic shapes. They answer at different endpoints - a non-partitioned
# topic returns 404 from partitioned-stats - so a seed with only one of them
# would leave half the driver uncovered.
spawn admin topics create-partitioned-topic "persistent://$NAMESPACE/orders" --partitions 3
spawn admin topics create "persistent://$NAMESPACE/audit"
spawn admin topics create "non-persistent://$NAMESPACE/telemetry"

# The dead-letter naming convention, spelled out the way the client libraries
# spell it. Nothing on the broker records the link, so the seed is what gives
# the cross-check a source to resolve - and an orphan, whose origin topic does
# not exist, is the row the page most needs to get right.
spawn admin topics create "persistent://$NAMESPACE/orders-worker-DLQ"
spawn admin topics create "persistent://$NAMESPACE/orders-worker-RETRY"
spawn admin topics create "persistent://$NAMESPACE/gone-reader-DLQ"
await

# Layer 4: subscriptions, created before anything is published so every message
# below lands in their backlog. A backlog is what the consumer page is read
# for, and an empty one would make the cross-check compare zero against zero.
spawn admin topics create-subscription "persistent://$NAMESPACE/orders" -s worker
spawn admin topics create-subscription "persistent://$NAMESPACE/orders" -s archive
spawn admin topics create-subscription "persistent://$NAMESPACE/audit" -s slow
spawn admin topics create-subscription "persistent://$NAMESPACE/orders-worker-DLQ" -s cleanup
await

# Layer 5: nothing consumes these, so they stay in the backlog.
spawn produce "persistent://$NAMESPACE/orders" "seeded" 5
spawn produce "persistent://$NAMESPACE/audit" "audited" 2
spawn produce "persistent://$NAMESPACE/orders-worker-DLQ" "gave-up" 3
await

# Verification. Everything above swallows its errors, so without this a seed
# that did nothing at all looks exactly like one that worked - and the
# cross-check would then fail somewhere far from the cause, or worse, pass by
# comparing two zeroes.
fail() {
  echo "pulsar seed verification failed: $1" >&2
  echo "the cross-check reads this topology, so it would fail further from the cause." >&2
  exit 1
}

echo "verifying"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# One layer again: these four reads do not depend on each other, and in series
# they would cost more JVM starts than the seeding above.
admin namespaces list "$TENANT" >"$tmp/namespaces" 2>/dev/null &
admin topics stats "persistent://$NAMESPACE/audit" >"$tmp/audit" 2>/dev/null &
admin topics partitioned-stats "persistent://$NAMESPACE/orders" >"$tmp/orders" 2>/dev/null &
admin topics list "$NAMESPACE" >"$tmp/topics" 2>/dev/null &
wait || true

grep -qE "^${NAMESPACE}[[:space:]]*$" "$tmp/namespaces" \
  || fail "namespace $NAMESPACE is not there"

[ -s "$tmp/audit" ] \
  || fail "the non-partitioned topic persistent://$NAMESPACE/audit is not there"

for subscription in worker archive; do
  grep -q "\"$subscription\"" "$tmp/orders" \
    || fail "subscription $subscription is missing from persistent://$NAMESPACE/orders"
done

# The one figure the cross-check cannot do without: comparing an empty backlog
# against an empty backlog would pass whatever the driver did. Publishing is
# asynchronous, so a first look that finds nothing gets a few more.
backlog_present() {
  grep -qE '"msgBacklog"[[:space:]]*:[[:space:]]*[1-9]' "$tmp/orders"
}

for _ in 1 2 3 4 5; do
  if backlog_present; then
    break
  fi
  sleep 2
  admin topics partitioned-stats "persistent://$NAMESPACE/orders" >"$tmp/orders" 2>/dev/null || true
done
backlog_present \
  || fail "persistent://$NAMESPACE/orders has an empty backlog; the cross-check would compare zero against zero"

echo "seeded: $NAMESPACE"
cat "$tmp/topics"
