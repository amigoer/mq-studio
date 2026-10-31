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

# redis-cli exits 0 on an error reply, and when stdout is not a terminal it
# prints one like any other value. Formatted output marks it "(error)", so
# every call whose reply is otherwise thrown away goes through here.
must() {
  local reply
  reply="$(cli --no-raw "$@")"
  case "$reply" in
    '(error) '*)
      echo "redis $*: ${reply#(error) }" >&2
      exit 1
      ;;
  esac
}

# Compared to PONG, not just run: a rejected login also exits 0.
if ! pong="$(cli ping 2>&1)" || [ "$pong" != PONG ]; then
  echo "redis did not answer PONG at $HOST:$PORT (${pong:-no reply}); start it with: npm run e2e:redis:up" >&2
  exit 1
fi

echo "clearing the previous seed"
# --scan drives the cursor itself and prints one key per line. Doing the
# iteration by hand here would be a second, worse implementation of what the
# driver already has to get right.
keys="$(cli --scan --pattern 'mqs-seed:*')"
if [ -n "$keys" ]; then
  # Not xargs: cli is a shell function, which xargs cannot run. Splitting on
  # whitespace is safe because every key here was named by this script.
  # shellcheck disable=SC2086
  must del $keys
fi

echo "seeding streams"
seed_stream() {
  local key="$1" count="$2" field="$3" i=1
  while [ "$i" -le "$count" ]; do
    must xadd "$key" '*' "$field" "value-$i" seq "$i"
    i=$((i + 1))
  done
}

seed_stream 'mqs-seed:orders' 120 order
seed_stream 'mqs-seed:payments' 60 payment
# No group reads this one, which is the "nobody is consuming" case: the page
# has to render that as an absence rather than as zero lag.
seed_stream 'mqs-seed:audit' 30 event

echo "seeding consumer groups"
must xgroup create 'mqs-seed:orders' settle-group 0
must xgroup create 'mqs-seed:orders' notify-group '$'
must xgroup create 'mqs-seed:payments' capture-group 0

echo "seeding a pending entries list"
# Read without acknowledging, from two consumers. What this leaves behind is
# the point: entries owned by a named consumer, with an idle time that grows
# while the app is open. A PEL board against a broker with an empty PEL proves
# nothing.
must xreadgroup group settle-group worker-1 count 12 streams 'mqs-seed:orders' '>'
must xreadgroup group settle-group worker-2 count 8 streams 'mqs-seed:orders' '>'
# Reassigning what worker-1 holds raises the delivery count without
# acknowledging anything, so the deliveries column has a value above one to
# show. XAUTOCLAIM rather than XCLAIM because it needs no entry ids: reading
# them back out of XPENDING here would be parsing a reply format for the sake
# of a fixture.
must xautoclaim 'mqs-seed:orders' settle-group worker-2 0 - count 6
must xreadgroup group capture-group collector count 5 streams 'mqs-seed:payments' '>'

echo "seeding non-stream keys"
# The stream list is a SCAN with TYPE stream. Without something of another
# type in the keyspace, a driver that forgot the filter would look correct.
must set 'mqs-seed:not-a-stream' 'a plain string'
must lpush 'mqs-seed:also-not-a-stream' one two three

echo
echo "seeded keys:"
cli --scan --pattern 'mqs-seed:*' | sort
echo
echo "mqs-seed:orders groups:"
cli xinfo groups 'mqs-seed:orders'
