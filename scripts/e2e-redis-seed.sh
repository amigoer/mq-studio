#!/usr/bin/env bash
#
# Seeds the Redis E2E broker with streams worth looking at.
#
# The live tests do not need this: each one creates the streams and groups it
# needs and deletes them again, which is what keeps them independent. This is
# for the other half of verification - opening the app against the broker and
# seeing whether the pages say true things. An empty broker cannot show a
# backlog, an idle consumer, or a pending entry that has been delivered twice
# and never acknowledged.
#
# Everything it creates is named mqs-seed:*, so it never collides with a test's
# keys or with anything a person made by hand. That prefix is also the only one
# the mqs-seed-readonly ACL user can reach, which is what makes that user a
# real restriction rather than a decorative one.
#
# Safe to re-run: the seeded keys are deleted first, so the counts below are
# what the broker holds afterwards rather than what has accumulated.
set -euo pipefail

HOST="${MQ_STUDIO_REDIS_HOST:-127.0.0.1}"
PORT="${MQ_STUDIO_REDIS_PORT:-6479}"
USER="${MQ_STUDIO_REDIS_USER:-mqstudio}"
PASS="${MQ_STUDIO_REDIS_PASS:-mqstudio}"
CONTAINER="${MQ_STUDIO_REDIS_CONTAINER:-mq-studio-e2e-redis-redis-1}"

if command -v redis-cli >/dev/null 2>&1; then
  cli() { redis-cli -h "$HOST" -p "$PORT" --user "$USER" --pass "$PASS" --no-auth-warning "$@"; }
else
  # No redis-cli on the host is the common case on a fresh checkout. The image
  # already has one, so borrow it rather than making the caller install a
  # client just to seed a broker.
  cli() { docker exec -i "$CONTAINER" redis-cli --user "$USER" --pass "$PASS" --no-auth-warning "$@"; }
fi

if ! cli ping >/dev/null 2>&1; then
  echo "redis is not answering at $HOST:$PORT; start it with: npm run e2e:redis:up" >&2
  exit 1
fi

echo "clearing the previous seed"
# --scan drives the cursor itself and prints one key per line. Doing the
# iteration by hand here would be a second, worse implementation of what the
# driver already has to get right.
keys="$(cli --scan --pattern 'mqs-seed:*')"
if [ -n "$keys" ]; then
  # shellcheck disable=SC2086
  echo "$keys" | tr '\n' ' ' | xargs -r cli del >/dev/null
fi

echo "seeding streams"
seed_stream() {
  local key="$1" count="$2" field="$3" i=1
  while [ "$i" -le "$count" ]; do
    cli xadd "$key" '*' "$field" "value-$i" seq "$i" >/dev/null
    i=$((i + 1))
  done
}

seed_stream 'mqs-seed:orders' 120 order
seed_stream 'mqs-seed:payments' 60 payment
# No group reads this one, which is the "nobody is consuming" case: the page
# has to render that as an absence rather than as zero lag.
seed_stream 'mqs-seed:audit' 30 event

echo "seeding consumer groups"
cli xgroup create 'mqs-seed:orders' settle-group 0 >/dev/null
cli xgroup create 'mqs-seed:orders' notify-group '$' >/dev/null
cli xgroup create 'mqs-seed:payments' capture-group 0 >/dev/null

echo "seeding a pending entries list"
# Read without acknowledging, from two consumers. What this leaves behind is
# the point: entries owned by a named consumer, with an idle time that grows
# while the app is open. A PEL board against a broker with an empty PEL proves
# nothing.
cli xreadgroup group settle-group worker-1 count 12 streams 'mqs-seed:orders' '>' >/dev/null
cli xreadgroup group settle-group worker-2 count 8 streams 'mqs-seed:orders' '>' >/dev/null
# Reassigning what worker-1 holds raises the delivery count without
# acknowledging anything, so the deliveries column has a value above one to
# show. XAUTOCLAIM rather than XCLAIM because it needs no entry ids: reading
# them back out of XPENDING here would be parsing a reply format for the sake
# of a fixture.
cli xautoclaim 'mqs-seed:orders' settle-group worker-2 0 - count 6 >/dev/null
cli xreadgroup group capture-group collector count 5 streams 'mqs-seed:payments' '>' >/dev/null

echo "seeding non-stream keys"
# The stream list is a SCAN with TYPE stream. Without something of another
# type in the keyspace, a driver that forgot the filter would look correct.
cli set 'mqs-seed:not-a-stream' 'a plain string' >/dev/null
cli lpush 'mqs-seed:also-not-a-stream' one two three >/dev/null

echo
echo "seeded keys:"
cli --scan --pattern 'mqs-seed:*' | sort
echo
echo "mqs-seed:orders groups:"
cli xinfo groups 'mqs-seed:orders'
