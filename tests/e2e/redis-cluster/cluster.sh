#!/bin/sh
#
# Starts six Redis nodes and forms a cluster out of them.
#
# Six processes in one container, which is not how the other environments are
# built, and the reason is Redis Cluster's addressing rather than convenience.
# A cluster tells clients where to go: a key that does not live on the node you
# asked for comes back as MOVED <slot> <host>:<port>, and the same address is
# what the nodes use to reach each other over the cluster bus. Kafka solves the
# equivalent problem with two listeners - INTERNAL on the compose network,
# EXTERNAL advertising 127.0.0.1 - but a Redis node has one bus and one
# announced address, so it cannot be both a container name and a host port at
# once. Six containers would therefore either be unreachable from the tests or
# unable to gossip with each other.
#
# Inside one container, 127.0.0.1:6500..6505 are the nodes themselves, and on
# the host the published ports map to exactly those numbers. One announced
# address is then correct from both sides, which is what makes the cluster
# usable from a test running outside docker.
set -eu

PORTS='6500 6501 6502 6503 6504 6505'
PASS=mqstudio

for port in $PORTS; do
  mkdir -p "/data/$port"
  # The bus port is the client port with a 1 in front - 6500 gossips on 16500.
  # It is never published: the bus is node to node, and every node is in here.
  redis-server \
    --port "$port" \
    --dir "/data/$port" \
    --cluster-enabled yes \
    --cluster-config-file nodes.conf \
    --cluster-node-timeout 5000 \
    --cluster-announce-ip 127.0.0.1 \
    --cluster-announce-port "$port" \
    --cluster-announce-bus-port "1$port" \
    --appendonly yes \
    --requirepass "$PASS" \
    --masterauth "$PASS" \
    --daemonize yes
done

for port in $PORTS; do
  until redis-cli -p "$port" -a "$PASS" --no-auth-warning ping 2>/dev/null | grep -q PONG; do
    sleep 0.2
  done
done

# Only on a cold start. On a restart the nodes read nodes.conf out of the
# volume and re-form on their own; running create again would refuse anyway,
# but failing here would take the container down with it.
if ! redis-cli -p 6500 -a "$PASS" --no-auth-warning cluster info 2>/dev/null | grep -q 'cluster_state:ok'; then
  echo 'forming the cluster'
  redis-cli -a "$PASS" --no-auth-warning --cluster create \
    127.0.0.1:6500 127.0.0.1:6501 127.0.0.1:6502 \
    127.0.0.1:6503 127.0.0.1:6504 127.0.0.1:6505 \
    --cluster-replicas 1 --cluster-yes
fi

# Hold the container open, and take it down if a node dies. Without this the
# container would stay up around a dead node and the tests would see a cluster
# that is merely degraded rather than absent.
while true; do
  for port in $PORTS; do
    redis-cli -p "$port" -a "$PASS" --no-auth-warning ping >/dev/null 2>&1 || exit 1
  done
  sleep 5
done
