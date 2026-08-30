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

exec docker compose -f compose.yaml up -d --wait
