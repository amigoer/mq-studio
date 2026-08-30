#!/usr/bin/env bash
#
# Fills the local RocketMQ with a cluster worth looking at.
#
# The screenshots and the README recording need a broker that has topics with
# names, consumer groups that read them, live throughput and a backlog or two.
# A freshly started E2E broker has none of that, so this creates the inventory
# with mqadmin and drives real traffic through it with the benchmark producer
# and consumer that ship inside the RocketMQ image.
#
# The load is real: TPS moves on its own, offsets advance, retries and dead
# letters accumulate. Nothing here touches the application's own code.
#
#   ./scripts/demo-data.sh seed     create the topics and consumer groups
#   ./scripts/demo-data.sh start    start producers and consumers
#   ./scripts/demo-data.sh lag [s]  push the idle groups behind by s seconds (default 60)
#   ./scripts/demo-data.sh dlq [group] [n]  put messages on that group's DLQ page
#   ./scripts/demo-data.sh status   what is running
#   ./scripts/demo-data.sh stop     stop the load, leave the data
#   ./scripts/demo-data.sh clean    stop and delete everything this created
#
# The benchmark JVMs default to a 1 GB heap each, which is why the classes are
# invoked directly rather than through benchmark/producer.sh.
set -euo pipefail

CONTAINER="${MQ_STUDIO_E2E_BROKER:-mq-studio-e2e-broker-1}"
NAMESRV="${MQ_STUDIO_E2E_NAMESRV:-namesrv:9876}"
BROKER="${MQ_STUDIO_E2E_BROKER_ADDR:-broker:10911}"
BENCH_DIR=/home/rocketmq/rocketmq-5.3.2/benchmark
HEAP="-Xms64m -Xmx160m -XX:+UseSerialGC"

# topic:queues:perm:ordered - queue counts and permissions vary so the columns
# that show them are not a wall of the same number.
TOPICS="
order-create:8:6:false
order-paid:8:6:false
order-cancel:4:6:false
order-refund:4:6:false
payment-result:8:6:false
payment-callback:4:6:false
inventory-deduct:4:6:true
inventory-rollback:4:6:false
user-register:4:6:false
user-login-event:8:6:false
coupon-issue:4:6:false
logistics-dispatch:4:6:false
logistics-track:8:6:true
points-award:4:6:false
notification-sms:4:6:false
notification-push:8:6:false
notification-email:2:6:false
search-index-sync:8:6:false
risk-control-event:4:6:false
audit-log:4:6:false
cdc-user-table:4:6:false
order-archive-v1:4:4:false
"

# Not GROUPS: bash reserves that name for the caller's group ids and
# silently drops an assignment to it.
CONSUMER_GROUPS="
order-service payment-service inventory-service user-service coupon-service
logistics-service notification-service points-service search-indexer
risk-engine data-sync-worker audit-collector bi-etl legacy-sync
"

# topic:threads - thread count is the only rate knob the benchmark producer
# has, so it is what gives the active-topic list a spread instead of a tie.
PRODUCERS="
order-create:4
payment-result:3
user-login-event:3
notification-push:2
logistics-track:2
audit-log:1
"

# group:topic:threads:failRate - the fail rates are what put real messages on
# the retry and dead-letter pages.
CONSUMERS="
order-service:order-create:4:0
payment-service:payment-result:2:0
notification-service:notification-push:2:0.03
risk-engine:user-login-event:2:0
logistics-service:logistics-track:1:0.01
"

# Groups deliberately left without a consumer. Each reads a topic a producer is
# actually running on, or there would be nothing for it to fall behind: these
# are what the backlog column and the lag alert are demonstrated on.
IDLE_GROUPS="inventory-service:order-create data-sync-worker:user-login-event bi-etl:audit-log legacy-sync:order-create"

require_container() {
  if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "broker container '$CONTAINER' is not running; start it with: npm run e2e:up" >&2
    exit 1
  fi
}

# mqadmin exits zero on plenty of failures and prints the stack trace instead,
# so a silent wrapper hides real problems. This one stays quiet when the call
# worked and shows the last lines when it did not, without aborting the run.
admin() {
  local output
  if ! output=$(docker exec "$CONTAINER" sh -c "sh mqadmin $* -n $NAMESRV" 2>&1) ||
    printf '%s' "$output" | grep -qE 'Exception|command failed'; then
    printf '    ! mqadmin %s\n' "$1" >&2
    printf '%s\n' "$output" | grep -E 'DESC|Exception' | head -2 | sed 's/^/      /' >&2
    return 0
  fi
}

seed() {
  require_container
  echo "$TOPICS" | while IFS=: read -r topic queues perm ordered; do
    [ -n "$topic" ] || continue
    printf '  topic %-22s queues=%-2s perm=%s%s\n' "$topic" "$queues" "$perm" \
      "$([ "$ordered" = true ] && printf ' ordered' || true)"
    admin "updateTopic -b $BROKER -t $topic -r $queues -w $queues -p $perm -o $ordered"
  done
  for group in $CONSUMER_GROUPS; do
    printf '  group %s\n' "$group"
    admin "updateSubGroup -b $BROKER -g $group"
    # The broker mints %RETRY%<group> when a consumer first attaches. A group
    # that has never had one is missing it, and consume stats fail outright on
    # the missing route - which is what the consumer page reads.
    admin "updateTopic -b $BROKER -t %RETRY%$group -r 1 -w 1 -p 6"
  done
  echo "seeded $(echo "$TOPICS" | grep -c .) topics and $(echo $CONSUMER_GROUPS | wc -w | tr -d ' ') consumer groups"
}

launch() {
  local class=$1 tag=$2
  shift 2
  docker exec -d "$CONTAINER" sh -c \
    "cd $BENCH_DIR && exec java $HEAP -cp '.:../conf:../lib/*' -Dmqstudio.demo=$tag \
     org.apache.rocketmq.example.benchmark.$class $* > /tmp/demo-$tag.log 2>&1"
}

start() {
  require_container
  stop_quiet
  echo "$PRODUCERS" | while IFS=: read -r topic threads; do
    [ -n "$topic" ] || continue
    printf '  producer %-20s threads=%s\n' "$topic" "$threads"
    launch Producer "p-$topic" \
      "-n $NAMESRV -t $topic -w $threads -s 512 -k true -l 4"
  done
  echo "$CONSUMERS" | while IFS=: read -r group topic threads fail; do
    [ -n "$group" ] || continue
    printf '  consumer %-20s on %-20s threads=%s fail=%s\n' "$group" "$topic" "$threads" "$fail"
    launch Consumer "c-$group" \
      "-n $NAMESRV -t $topic -g $group -w $threads -r $fail"
  done
  echo "load started; give it a minute, then run: ./scripts/demo-data.sh lag"
}

# lag walks the idle groups' offsets back in time, which is the only way to show
# a real backlog for a group nothing is consuming: with no offset committed, the
# broker reports no progress rather than a lag.
#
# The window is in seconds and small on purpose. Producers here run at a few
# thousand a second, so resetting to the start of the log gives a backlog in the
# millions - a real number, but not one that reads well in a screenshot. Re-run
# it any time to bring the figures back down.
lag() {
  require_container
  local seconds=${1:-60}
  local since=$(( ($(date +%s) - seconds) * 1000 ))
  for pair in $IDLE_GROUPS; do
    group=${pair%%:*}
    topic=${pair##*:}
    printf '  %-20s behind %ss on %s\n' "$group" "$seconds" "$topic"
    admin "resetOffsetByTime -g $group -t $topic -s $since -f true"
  done
  echo "idle groups pushed back ${seconds}s; their backlog grows while the producers run"
}

# dlq fills the dead-letter page.
#
# Not by driving real messages all the way there: a message reaches the
# dead-letter queue only after exhausting its retries, the client's own
# maxReconsumeTimes of sixteen overrides whatever the group config says, and
# RocketMQ spaces those retries out on its delay levels - ten seconds, thirty,
# a minute, and on up to two hours. Waiting it out takes over four hours.
#
# So this writes the batch straight onto %DLQ%<group>, which is an ordinary
# topic the broker would have created itself. The retry page needs no such help:
# the running consumers' fail rates fill %RETRY% for real.
dlq() {
  require_container
  local group=${2:-coupon-service} batch=${3:-400}
  local topic="%DLQ%$group"

  admin "updateTopic -b $BROKER -t $topic -r 1 -w 1 -p 6"
  printf '  writing %s dead letters to %s\n' "$batch" "$topic"
  docker exec "$CONTAINER" sh -c \
    "cd $BENCH_DIR && java $HEAP -cp '.:../conf:../lib/*' \
     org.apache.rocketmq.example.benchmark.Producer \
     -n $NAMESRV -t '$topic' -w 2 -s 512 -k true -l 3 -q $batch > /tmp/demo-dlq-send.log 2>&1"

  if docker exec "$CONTAINER" sh -c \
    "sh mqadmin topicStatus -n $NAMESRV -t '$topic' 2>/dev/null | grep -q broker"; then
    printf '  dead letters are on %s\n' "$topic"
  else
    echo "  the dead-letter topic did not take the batch" >&2
  fi
}

stop_quiet() {
  docker exec "$CONTAINER" sh -c "pkill -f 'mqstudio.demo=' || true" >/dev/null 2>&1 || true
}

stop() {
  require_container
  stop_quiet
  echo "load stopped; topics, groups and messages are still there"
}

status() {
  require_container
  local count
  count=$(docker exec "$CONTAINER" sh -c "pgrep -fc 'mqstudio.demo=' || true" | tr -d '\r')
  echo "benchmark processes running: ${count:-0}"
  docker exec "$CONTAINER" sh -c "sh mqadmin clusterList -n $NAMESRV 2>/dev/null | tail -4" || true
}

clean() {
  require_container
  stop_quiet
  echo "$TOPICS" | while IFS=: read -r topic _ _ _; do
    [ -n "$topic" ] || continue
    admin "deleteTopic -c DefaultCluster -t $topic"
  done
  for group in $CONSUMER_GROUPS; do
    admin "deleteSubGroup -b $BROKER -g $group"
    admin "deleteTopic -c DefaultCluster -t %RETRY%$group"
    admin "deleteTopic -c DefaultCluster -t %DLQ%$group"
  done
  echo "removed the demo topics and consumer groups"
}

case "${1:-}" in
  seed) seed ;;
  dlq) dlq "$@" ;;
  start) start ;;
  lag) lag "${2:-}" ;;
  stop) stop ;;
  status) status ;;
  clean) clean ;;
  *)
    sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
