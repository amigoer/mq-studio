#!/bin/sh
# 构建当前平台 daemon、桌面端，并打出内部测试安装包到 release/
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(dirname "$script_dir")"
cd "$repo_root"

sh scripts/build-daemon.sh
npm --prefix desktop run build

case "$(go env GOOS)" in
  darwin) platform=mac ;;
  windows) platform=win ;;
  *) platform=$(go env GOOS) ;;
esac
case "$(go env GOARCH)" in
  amd64) arch=x64 ;;
  *) arch=$(go env GOARCH) ;;
esac

(cd desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --"$platform" --"$arch" --publish never)
