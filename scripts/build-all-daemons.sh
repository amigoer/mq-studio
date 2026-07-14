#!/bin/sh
set -eu
for os in mac win linux; do
  for arch in x64 arm64; do
    sh scripts/build-daemon.sh "$os" "$arch"
  done
done
