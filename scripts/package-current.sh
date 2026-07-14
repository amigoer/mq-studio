#!/bin/sh
set -eu
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
