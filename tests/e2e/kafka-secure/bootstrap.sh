#!/usr/bin/env bash
# Creates the superuser the SASL listener authenticates against.
#
# It runs beside the broker rather than before it because a SCRAM credential
# lives in the cluster's own metadata: there is nothing to write it into until
# the broker is up. The internal listener is plaintext, which is how this
# reaches the broker without the credential it is about to create.
set -euo pipefail

for _ in $(seq 1 60); do
  if /opt/kafka/bin/kafka-configs.sh --bootstrap-server kafka-secure:19192 \
      --alter --add-config 'SCRAM-SHA-512=[password=mqstudio]' \
      --entity-type users --entity-name mqstudio >/dev/null 2>&1; then
    echo "mq-studio: superuser mqstudio created"
    exit 0
  fi
  sleep 2
done

echo "mq-studio: gave up creating the superuser" >&2
exit 1
