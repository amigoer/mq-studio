#!/usr/bin/env bash
#
# Seeds the RabbitMQ E2E broker with a topology worth looking at.
#
# The live tests do not need this: each one declares what it needs and removes
# it again, which is what keeps them independent. This is for the other half of
# verification - opening the app against the broker and seeing whether the
# pages say true things. An empty broker cannot show a backlog, a dead letter,
# an alternate exchange or a policy that matched.
#
# Everything it creates is named mqs-seed-*, so it never collides with a test's
# resources or with anything a person made by hand.
#
# Safe to re-run: every call is a PUT, and the message counts are topped up
# rather than duplicated.
set -euo pipefail

API="${MQ_STUDIO_RABBITMQ_API:-http://127.0.0.1:15672}"
USER="${MQ_STUDIO_RABBITMQ_USER:-mqstudio}"
PASS="${MQ_STUDIO_RABBITMQ_PASS:-mqstudio}"
VHOST_RAW="${MQ_STUDIO_RABBITMQ_VHOST:-/}"
# The default virtual host is literally "/", which has to be escaped in a path.
VHOST="${VHOST_RAW//\//%2F}"

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(--silent --show-error --fail-with-body --user "$USER:$PASS" -X "$method")
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data "$body")
  fi
  curl "${args[@]}" "$API$path"
}

if ! curl --silent --fail --max-time 5 --user "$USER:$PASS" "$API/api/overview" >/dev/null; then
  echo "rabbitmq management API is not answering at $API; start it with: npm run e2e:rabbitmq:up" >&2
  exit 1
fi

echo "seeding exchanges"
api PUT "/api/exchanges/$VHOST/mqs-seed-orders" \
  '{"type":"topic","durable":true,"arguments":{"alternate-exchange":"mqs-seed-unrouted"}}' >/dev/null
api PUT "/api/exchanges/$VHOST/mqs-seed-unrouted" '{"type":"fanout","durable":true}' >/dev/null
api PUT "/api/exchanges/$VHOST/mqs-seed-dlx" '{"type":"direct","durable":true}' >/dev/null

echo "seeding queues"
# A queue that dead-letters, so the dead-letter page has a topology to draw.
api PUT "/api/queues/$VHOST/mqs-seed-settle" \
  '{"durable":true,"arguments":{"x-queue-type":"quorum","x-dead-letter-exchange":"mqs-seed-dlx","x-dead-letter-routing-key":"settle.failed"}}' >/dev/null
api PUT "/api/queues/$VHOST/mqs-seed-settle-dlq" '{"durable":true}' >/dev/null
# Nothing consumes this one, which is the "backlog nobody is reading" case.
api PUT "/api/queues/$VHOST/mqs-seed-audit" \
  '{"durable":true,"arguments":{"x-max-length":100000,"x-overflow":"reject-publish"}}' >/dev/null
api PUT "/api/queues/$VHOST/mqs-seed-unrouted" '{"durable":true}' >/dev/null
api PUT "/api/queues/$VHOST/mqs-seed-events" \
  '{"durable":true,"arguments":{"x-queue-type":"stream"}}' >/dev/null

echo "seeding bindings"
api POST "/api/bindings/$VHOST/e/mqs-seed-orders/q/mqs-seed-settle" \
  '{"routing_key":"order.settle.#"}' >/dev/null
api POST "/api/bindings/$VHOST/e/mqs-seed-orders/q/mqs-seed-audit" \
  '{"routing_key":"order.#"}' >/dev/null
api POST "/api/bindings/$VHOST/e/mqs-seed-dlx/q/mqs-seed-settle-dlq" \
  '{"routing_key":"settle.failed"}' >/dev/null
api POST "/api/bindings/$VHOST/e/mqs-seed-unrouted/q/mqs-seed-unrouted" '{"routing_key":""}' >/dev/null

echo "seeding a policy"
api PUT "/api/policies/$VHOST/mqs-seed-ttl" \
  '{"pattern":"^mqs-seed-audit$","definition":{"message-ttl":86400000},"priority":1,"apply-to":"queues"}' >/dev/null

echo "seeding a user"
api PUT /api/users/mqs-seed-reader '{"password":"mqs-seed-reader","tags":"monitoring"}' >/dev/null
# Read-only: an empty configure and write regex denies everything, which is
# what makes the three-column permission view worth reading.
api PUT "/api/permissions/$VHOST/mqs-seed-reader" \
  '{"configure":"","write":"","read":".*"}' >/dev/null

echo "publishing messages"
publish() {
  local exchange="$1" key="$2" count="$3"
  for _ in $(seq 1 "$count"); do
    api POST "/api/exchanges/$VHOST/$exchange/publish" \
      "{\"properties\":{\"delivery_mode\":2,\"content_type\":\"application/json\"},\"routing_key\":\"$key\",\"payload\":\"{\\\"seeded\\\":true}\",\"payload_encoding\":\"string\"}" >/dev/null
  done
}
publish mqs-seed-orders order.settle.eu 20
publish mqs-seed-orders order.audit 40
# Nothing is bound to this key, so the alternate exchange catches it - which is
# the only way the unroutable count on the overview is ever non-zero.
publish mqs-seed-orders nothing.is.bound.to.this 5
publish mqs-seed-dlx settle.failed 3

echo "seeded: exchanges, queues, bindings, a policy, a read-only user and some messages"
