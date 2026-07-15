#!/bin/sh
set -eu

case "$(go env GOOS)" in
  darwin) platform=mac ;;
  windows) platform=win ;;
  *) platform=$(go env GOOS) ;;
esac
case "$(go env GOARCH)" in
  amd64) arch=x64 ;;
  *) arch=$(go env GOARCH) ;;
esac

suffix=""
if [ "$platform" = win ]; then suffix=".exe"; fi

daemon_path="$(pwd)/desktop/resources/bin/$platform/$arch/rocket-leafd$suffix"
if [ ! -f "$daemon_path" ]; then
  echo "未找到当前平台 daemon，请先运行 make build。" >&2
  exit 1
fi

(cd desktop && ROCKET_LEAF_DAEMON_PATH="$daemon_path" ./node_modules/.bin/electron .)
