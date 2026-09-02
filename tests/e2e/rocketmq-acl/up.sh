#!/usr/bin/env bash
#
# Starts the ACL-enabled RocketMQ from a pristine ACL file.
#
# The broker keeps its ACL in memory and flushes it back to plain_acl.yml, so
# the template can only be restored while nothing is running - copying it under
# a live broker is silently overwritten. Everything is stopped first for that
# reason; the message store survives in its named volume.
#
# Without this a second run inherits whatever the last one left behind,
# including a whitelist that no longer covers the caller - and since
# rocketmq-admin-go never signs its requests, that locks the tests out.
set -euo pipefail
cd "$(dirname "$0")"

docker compose -f compose.yaml down --remove-orphans >/dev/null 2>&1 || true

# rm -rf, not just overwrite: a bind mount whose host path is missing gets a
# directory created in its place, and a directory here is not something `cp`
# would replace.
rm -rf plain_acl.yml
cp plain_acl.seed.yml plain_acl.yml

docker compose -f compose.yaml up -d --wait

# `--wait` returns when the container is healthy, which is earlier than the
# broker being usable: it has still to register with the name server, and a
# client that dials in that window is told there is no master broker at all.
# The single serial CI job never met this - twenty minutes of starting other
# brokers went by before anything connected - but one job per broker family
# runs the tests seconds after this returns.
ATTEMPTS="${MQ_STUDIO_E2E_ACL_ATTEMPTS:-30}"
DELAY="${MQ_STUDIO_E2E_ACL_DELAY:-2}"
NAMESRV="${MQ_STUDIO_E2E_ACL_NAMESRV:-namesrv:9876}"

broker="$(docker compose -f compose.yaml ps -q broker)"
for _ in $(seq 1 "$ATTEMPTS"); do
  # A registered master carries broker id 0, which is the third column.
  if docker exec "$broker" sh -c "sh mqadmin clusterList -n $NAMESRV" 2>/dev/null |
    awk 'NR > 1 && $3 == "0" { found = 1 } END { exit !found }'; then
    echo "acl broker registered with $NAMESRV"
    exit 0
  fi
  sleep "$DELAY"
done

echo "the acl broker did not register with $NAMESRV in $ATTEMPTS attempts" >&2
exit 1
