#!/bin/sh
set -eu

output=$(gofmt -l daemon 2>/dev/null || true)
if [ -n "$output" ]; then
  echo "以下 Go 文件尚未通过 gofmt："
  printf '  %s\n' $output
  echo "请运行 npm run format"
  exit 1
fi
