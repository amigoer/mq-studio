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

ATTEMPTS="${MQ_STUDIO_E2E_SEED_ATTEMPTS:-30}"
DELAY="${MQ_STUDIO_E2E_SEED_DELAY:-2}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "broker container '$CONTAINER' is not running; start it with: npm run e2e:up" >&2
  exit 1
fi

run() { docker exec "$CONTAINER" sh -c "$1"; }

# mqadmin exits 0 even when its command threw, so `set -e` never sees the
# failure and the stack trace it prints is the only signal there is. Retried
# because compose reports the broker healthy before its listener accepts: the
# calls that land in that window fail with RemotingConnectException, and the
# first resource is simply absent while the seed goes on to print "seeded".
attempt() {
  local label="$1" command="$2" output
  echo "$label"
  for _ in $(seq 1 "$ATTEMPTS"); do
    output="$(run "$command" 2>&1 || true)"
    case "$output" in
      *Exception*|*"command failed"*) sleep "$DELAY" ;;
      *) return 0 ;;
    esac
  done
  echo "$output" >&2
  echo "$label did not succeed in $ATTEMPTS attempts" >&2
  exit 1
}

seed_topic() {
  attempt "seeding topic $1" "sh mqadmin updateTopic -n $NAMESRV -b $BROKER -t '$1' -r 4 -w 4"
}

seed_group() {
  attempt "seeding consumer group $1" "sh mqadmin updateSubGroup -n $NAMESRV -b $BROKER -g '$1'"
}

seed_topic "$TOPIC"
seed_group "$GROUP"
seed_topic "$NAMESPACE%$NS_TOPIC"
seed_group "$NAMESPACE%$NS_GROUP"

# What the tests read is the name server, which learns a topic from the
# broker's registration and not from the call that created it. Asserting the
# end state is what keeps a seed that created nothing from reaching them
# looking done - the failure this whole script existed to not have.
missing=""
for _ in $(seq 1 "$ATTEMPTS"); do
  listed="$(run "sh mqadmin topicList -n $NAMESRV" 2>/dev/null || true)"
  missing=""
  for topic in "$TOPIC" "$NAMESPACE%$NS_TOPIC"; do
    printf '%s\n' "$listed" | grep -qxF "$topic" || missing="$missing $topic"
  done
  [ -z "$missing" ] && break
  sleep "$DELAY"
done
if [ -n "$missing" ]; then
  echo "the name server does not list:$missing" >&2
  exit 1
fi

echo "seeded: topic=$TOPIC group=$GROUP namespace=$NAMESPACE"
