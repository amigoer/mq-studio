#!/bin/sh
# Unified Electron launch entry:
#   sh scripts/run-electron.sh dev   # development (electron-vite)
#   sh scripts/run-electron.sh run   # run from built artifacts temporarily
set -eu

mode="${1:-}"
if [ "$mode" != "dev" ] && [ "$mode" != "run" ]; then
  echo "usage: sh scripts/run-electron.sh <dev|run>" >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(dirname "$script_dir")"
desktop_dir="$repo_root/desktop"

platform_info() {
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
}

# For macOS dev/temporary runs, prepare an Electron.app with app name and icon, then ad-hoc re-sign.
# Must fully copy (do not symlink Frameworks), or signature checks fail with Trace/BPT trap.
prepare_macos_app() {
  destination="${1:?}"
  source_app="$desktop_dir/node_modules/electron/dist/Electron.app"
  icon_icns="$desktop_dir/resources/icon.icns"

  if [ ! -d "$source_app" ]; then
    echo "Electron.app not found; run make install first." >&2
    exit 1
  fi
  if [ ! -f "$icon_icns" ]; then
    echo "app icon not found at $icon_icns; run make icons first." >&2
    exit 1
  fi

  rm -rf "$destination"
  cp -R "$source_app" "$destination"
  mv "$destination/Contents/MacOS/Electron" "$destination/Contents/MacOS/Rocket Leaf"
  cp "$icon_icns" "$destination/Contents/Resources/electron.icns"
  cp "$icon_icns" "$destination/Contents/Resources/icon.icns"

  plist="$destination/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Rocket Leaf" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName Rocket Leaf" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.rocketleaf.app.dev" "$plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Rocket Leaf" "$plist"
  if /usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$plist" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon.icns" "$plist"
  else
    /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string icon.icns" "$plist"
  fi

  chmod +x "$destination/Contents/MacOS/Rocket Leaf"
  xattr -cr "$destination" 2>/dev/null || true
  codesign --force --deep --sign - "$destination" >/dev/null
}

with_macos_app() {
  temp_root="$(mktemp -d "${TMPDIR:-/tmp}/rocket-leaf-electron.XXXXXX")"
  app_bundle="$temp_root/Rocket Leaf.app"
  cleanup() {
    rm -rf "$temp_root"
  }
  trap cleanup EXIT INT TERM
  prepare_macos_app "$app_bundle"
  export ELECTRON_EXEC_PATH="$app_bundle/Contents/MacOS/Rocket Leaf"
  "$@"
}

# Prefer a prebuilt daemon binary when present so temporary macOS .app bundles
# (which look packaged but do not embed rocket-leafd) still start correctly.
export_daemon_path_if_present() {
  platform_info
  daemon_path="$desktop_dir/resources/bin/$platform/$arch/rocket-leafd$suffix"
  if [ -f "$daemon_path" ]; then
    export ROCKET_LEAF_DAEMON_PATH="$daemon_path"
  fi
}

run_dev() {
  export_daemon_path_if_present
  cd "$desktop_dir"
  if [ "$(uname -s)" = Darwin ]; then
    with_macos_app ./node_modules/.bin/electron-vite dev
  else
    ./node_modules/.bin/electron-vite dev
  fi
}

run_built() {
  platform_info
  daemon_path="$desktop_dir/resources/bin/$platform/$arch/rocket-leafd$suffix"
  if [ ! -f "$daemon_path" ]; then
    echo "daemon for current platform not found; run make build first." >&2
    exit 1
  fi

  cd "$desktop_dir"
  export ROCKET_LEAF_DAEMON_PATH="$daemon_path"
  # Launch via electron CLI so a temporary .app does not enable the updater by mistake.
  if [ "$(uname -s)" = Darwin ]; then
    with_macos_app ./node_modules/.bin/electron .
  else
    ./node_modules/.bin/electron .
  fi
}

case "$mode" in
  dev) run_dev ;;
  run) run_built ;;
esac
