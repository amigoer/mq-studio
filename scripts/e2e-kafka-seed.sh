#!/usr/bin/env bash
# Fills the E2E Kafka cluster with a topology worth looking at.
#
# Not needed by any test: every live test creates and cleans up what it needs,
# because a suite that depends on a seed is a suite that fails differently
# depending on whether someone ran it. This exists so the app has something on
# screen when a person opens it against the cluster.
#
# Idempotent: it can be run twice.
set -euo pipefail

CONTAINER="${KAFKA_CONTAINER:-mq-studio-e2e-kafka-kafka-1-1}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka-1:19092}"
PREFIX="mqs-seed"

kafka() {
  docker exec "$CONTAINER" "/opt/kafka/bin/$1" --bootstrap-server "$BOOTSTRAP" "${@:2}"
}

topic() {
  local name="$1" partitions="$2" replication="$3"
  shift 3
  if kafka kafka-topics.sh --list | grep -qx "$name"; then
    echo "  $name exists"
    return
  fi
  kafka kafka-topics.sh --create --topic "$name" \
    --partitions "$partitions" --replication-factor "$replication" "$@" >/dev/null
  echo "  $name created"
}

echo "seeding $CONTAINER"

# A spread of shapes, so every column on the topic board has something in it:
# a compacted topic, one with a short retention, and one big enough to page.
topic "$PREFIX-orders" 6 3 --config cleanup.policy=delete --config retention.ms=604800000 \
  --config min.insync.replicas=2
topic "$PREFIX-profiles" 3 3 --config cleanup.policy=compact --config min.insync.replicas=2
topic "$PREFIX-events" 12 3 --config retention.ms=3600000
# Replication factor 1 on purpose: it is the one topic whose loss of a broker
# is visible as an offline partition rather than as a warning.
topic "$PREFIX-single" 1 1

echo "producing records"
for i in $(seq 1 200); do
  echo "k$i:{\"id\":$i,\"kind\":\"order\"}"
done | docker exec -i "$CONTAINER" /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server "$BOOTSTRAP" --topic "$PREFIX-orders" \
  --property parse.key=true --property key.separator=: >/dev/null
echo "  200 records in $PREFIX-orders"

# A consumer group exists once something commits an offset to it, so this is
# how one is made without leaving a consumer running.
#
# The lag is built by going to the end and stepping back, not by committing an
# absolute offset: 200 records over six partitions is about thirty each, so an
# absolute 120 is past every partition's end and Kafka clamps it to the end -
# leaving a group that is caught up while the script claims a backlog.
echo "committing offsets"
kafka kafka-consumer-groups.sh --group "$PREFIX-settle" --topic "$PREFIX-orders" \
  --reset-offsets --to-latest --execute >/dev/null
kafka kafka-consumer-groups.sh --group "$PREFIX-settle" --topic "$PREFIX-orders" \
  --reset-offsets --shift-by -15 --execute >/dev/null
echo "  $PREFIX-settle is 15 records behind on each of 6 partitions"
kafka kafka-consumer-groups.sh --group "$PREFIX-audit" --topic "$PREFIX-orders" \
  --reset-offsets --to-earliest --execute >/dev/null
echo "  $PREFIX-audit is at the start"

echo "done"
