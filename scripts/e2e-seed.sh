#!/usr/bin/env bash
#
# Seeds the RocketMQ E2E broker with the topics and consumer groups the live
# tests read.
#
# Two of each: one pair under no namespace, and one pair inside NS_E2E. A
# namespace is a client-side naming convention, so a namespaced topic is an
# ordinary topic whose name happens to carry the separator - which is exactly
# what the namespace tests need to prove.
#
# Safe to re-run: updateTopic and updateSubGroup both upsert.
set -euo pipefail

CONTAINER="${MQ_STUDIO_E2E_BROKER:-mq-studio-e2e-broker-1}"
NAMESRV="${MQ_STUDIO_E2E_NAMESRV:-namesrv:9876}"
BROKER="${MQ_STUDIO_E2E_BROKER_ADDR:-broker:10911}"

TOPIC="${MQ_STUDIO_E2E_TOPIC:-MQ_STUDIO_E2E}"
GROUP="${MQ_STUDIO_E2E_GROUP:-MQ_STUDIO_E2E_GROUP}"

# The namespaced pair carries its own base names, deliberately. Seeded under
# the same names, the scoped and unscoped views would both show
# "MQ_STUDIO_E2E" and no assertion could tell them apart.
NAMESPACE="${MQ_STUDIO_E2E_NAMESPACE:-NS_E2E}"
NS_TOPIC="${MQ_STUDIO_E2E_NS_TOPIC:-MQ_STUDIO_E2E_NS}"
NS_GROUP="${MQ_STUDIO_E2E_NS_GROUP:-MQ_STUDIO_E2E_NS_GROUP}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "broker container '$CONTAINER' is not running; start it with: npm run e2e:up" >&2
  exit 1
fi

run() { docker exec "$CONTAINER" sh -c "$1"; }

seed_topic() {
  echo "seeding topic $1"
  run "sh mqadmin updateTopic -n $NAMESRV -b $BROKER -t '$1' -r 4 -w 4" >/dev/null
}

seed_group() {
  echo "seeding consumer group $1"
  run "sh mqadmin updateSubGroup -n $NAMESRV -b $BROKER -g '$1'" >/dev/null
}

seed_topic "$TOPIC"
seed_group "$GROUP"
seed_topic "$NAMESPACE%$NS_TOPIC"
seed_group "$NAMESPACE%$NS_GROUP"

echo "seeded: topic=$TOPIC group=$GROUP namespace=$NAMESPACE"
