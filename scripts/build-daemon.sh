#!/bin/sh
set -eu

electron_os=${1:-}
electron_arch=${2:-}

if [ -z "$electron_os" ]; then
  case "$(go env GOOS)" in
    darwin) electron_os=mac ;;
    windows) electron_os=win ;;
    *) electron_os=$(go env GOOS) ;;
  esac
fi
if [ -z "$electron_arch" ]; then
  case "$(go env GOARCH)" in
    amd64) electron_arch=x64 ;;
    *) electron_arch=$(go env GOARCH) ;;
  esac
fi

case "$electron_os" in
  mac) goos=darwin ;;
  win) goos=windows ;;
  linux) goos=linux ;;
  *) echo "不支持的平台: $electron_os" >&2; exit 1 ;;
esac
case "$electron_arch" in
  x64) goarch=amd64 ;;
  arm64) goarch=arm64 ;;
  *) echo "不支持的架构: $electron_arch" >&2; exit 1 ;;
esac

suffix=""
if [ "$goos" = windows ]; then suffix=".exe"; fi
output="desktop/resources/bin/$electron_os/$electron_arch/rocket-leafd$suffix"
mkdir -p "$(dirname "$output")"

(cd daemon && CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build -trimpath -ldflags "-s -w -X main.appVersion=2.0.0" -o "../$output" ./cmd/rocket-leafd)
echo "已生成 $output"
