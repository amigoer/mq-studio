#!/usr/bin/env bash
#
# Seeds the NATS E2E cluster with streams worth looking at.
#
# The live tests do not need this: each one creates the streams and consumers
# it needs and removes them again, which is what keeps them independent. This
# is for the other half of verification - the cross-check, which compares
# figures the app computes against the same figures from the nats CLI, and
# opening the app against the cluster to see whether the boards say true
# things. Comparing zero against zero proves nothing, and an empty cluster
# cannot show a backlog, an unacknowledged delivery, or a stream whose
# replicas are spread over three servers.
#
# Everything it creates is named MQS_SEED_*, on subjects under mqs.seed.*, so
# it never collides with a test's objects - those are MQS_TEST_* - or with
# anything a person made by hand.
#
# Safe to re-run: the seeded streams are removed first, so the counts below
# are what the cluster holds afterwards rather than what has accumulated.
set -euo pipefail

CONTAINER="${MQ_STUDIO_NATS_CONTAINER:-mq-studio-e2e-nats-nats-box-1}"

# The CLI lives in the nats-box sidecar rather than on the host: a fresh
# checkout has no nats binary, and borrowing the one in the image is what the
# other families' seeds do with redis-cli and pulsar-admin.
cli() { docker exec -i "$CONTAINER" nats "$@"; }

if ! cli server check connection >/dev/null 2>&1; then
  echo "the nats cluster is not answering; start it with: npm run e2e:nats:up" >&2
  exit 1
fi

echo "==> removing anything left from a previous run"
for stream in MQS_SEED_ORDERS MQS_SEED_EVENTS MQS_SEED_AUDIT; do
  cli stream rm "$stream" -f >/dev/null 2>&1 || true
done

echo "==> MQS_SEED_ORDERS: three replicas on file storage, 200 messages"
# Three replicas so the stream detail has a leader, two followers and a real
# answer to "is this stream healthy". A single-replica stream reports none of
# that, and it is the whole reason this environment runs three servers.
cli stream add MQS_SEED_ORDERS \
  --subjects 'mqs.seed.orders.>' \
  --storage file --replicas 3 --retention limits --discard old \
  --defaults >/dev/null
cli pub 'mqs.seed.orders.created' 'order {{Count}}' --count 120 >/dev/null
cli pub 'mqs.seed.orders.shipped' 'order {{Count}}' --count 80 >/dev/null

echo "==> MQS_SEED_EVENTS: memory storage, one replica, 50 messages"
# Memory rather than file, so the streams board has both storage kinds to
# render and the account usage figures have a memory component as well as a
# file one - they are separate limits and separate meters.
cli stream add MQS_SEED_EVENTS \
  --subjects 'mqs.seed.events.>' \
  --storage memory --replicas 1 --retention limits --discard old \
  --defaults >/dev/null
cli pub 'mqs.seed.events.tick' 'tick {{Count}}' --count 50 >/dev/null

echo "==> MQS_SEED_AUDIT: a work queue, three replicas, 30 messages"
# A work queue retains a message only until someone consumes it, which is a
# different shape from the two above and the one place the retention column
# means something an operator has to act on.
cli stream add MQS_SEED_AUDIT \
  --subjects 'mqs.seed.audit.>' \
  --storage file --replicas 3 --retention work --discard old \
  --defaults >/dev/null
cli pub 'mqs.seed.audit.write' 'entry {{Count}}' --count 30 >/dev/null

echo "==> consumers"
# Three consumers in three states, because a consumer list where every row
# says the same thing cannot show whether the columns are wired to anything.

# Caught up on 120 of 200: a real backlog to display.
cli consumer add MQS_SEED_ORDERS seed-worker \
  --pull --deliver all --ack explicit --replicas 3 --defaults >/dev/null
cli consumer next MQS_SEED_ORDERS seed-worker --count 120 --ack >/dev/null 2>&1 || true

# Never started: the whole stream is outstanding.
cli consumer add MQS_SEED_ORDERS seed-idle \
  --pull --deliver all --ack explicit --replicas 3 --defaults >/dev/null

# Holding five deliveries it has not acknowledged. The hour-long ack wait is
# what makes that state survive long enough to be looked at - at the default
# thirty seconds the pending count is gone before anyone opens the page.
cli consumer add MQS_SEED_ORDERS seed-stuck \
  --pull --deliver all --ack explicit --wait 1h --replicas 3 --defaults >/dev/null
cli consumer next MQS_SEED_ORDERS seed-stuck --count 5 --no-ack >/dev/null 2>&1 || true

cli consumer add MQS_SEED_AUDIT seed-audit \
  --pull --deliver all --ack explicit --replicas 3 --defaults >/dev/null

echo
echo "seeded:"
cli stream ls
