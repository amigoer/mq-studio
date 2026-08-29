#!/usr/bin/env bash
#
# Seeds the RocketMQ E2E broker with a topic and a consumer group.
#
# The live tests need a consumer group to act on, and mq-studio cannot create
# one: rocketmq-admin-go sends the subscription group config in extFields while
# RocketMQ 5.x reads it from the request body, so every create is answered with
# a NullPointerException. The broker's own mqadmin sends the body, so the group
# is seeded through it until the library is fixed.
#
# Safe to re-run: updateTopic and updateSubGroup both upsert.
set -euo pipefail

CONTAINER="${MQ_STUDIO_E2E_BROKER:-mq-studio-e2e-broker-1}"
NAMESRV="${MQ_STUDIO_E2E_NAMESRV:-namesrv:9876}"
BROKER="${MQ_STUDIO_E2E_BROKER_ADDR:-broker:10911}"

TOPIC="${MQ_STUDIO_E2E_TOPIC:-MQ_STUDIO_E2E}"
GROUP="${MQ_STUDIO_E2E_GROUP:-MQ_STUDIO_E2E_GROUP}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "broker container '$CONTAINER' is not running; start it with: npm run e2e:up" >&2
  exit 1
fi

run() { docker exec "$CONTAINER" sh -c "$1"; }

echo "seeding topic $TOPIC"
run "sh mqadmin updateTopic -n $NAMESRV -b $BROKER -t $TOPIC -r 4 -w 4" >/dev/null

echo "seeding consumer group $GROUP"
run "sh mqadmin updateSubGroup -n $NAMESRV -b $BROKER -g $GROUP" >/dev/null

echo "seeded: topic=$TOPIC group=$GROUP"
