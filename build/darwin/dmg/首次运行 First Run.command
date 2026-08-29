#!/bin/bash
# Clears the quarantine flag macOS puts on downloaded builds.
#
# Needed only while MQ Studio ships ad-hoc signed: Gatekeeper rejects a
# quarantined ad-hoc bundle outright ("is damaged"), and on macOS 15+ there is
# often no GUI override for that verdict. settings.py drops this file from the
# image once the build is signed with a Developer ID.
set -uo pipefail

BUNDLE="MQ Studio.app"
BLUE=$'\033[1;34m'; GREEN=$'\033[1;32m'; RED=$'\033[1;31m'; DIM=$'\033[2m'; OFF=$'\033[0m'

say() { printf '%s\n' "$*"; }

say ""
say "${BLUE}MQ Studio · 首次运行 / First Run${OFF}"
say "${DIM}────────────────────────────────────────────────${OFF}"
say ""

APP=""
for candidate in "/Applications/$BUNDLE" "$HOME/Applications/$BUNDLE"; do
  if [ -d "$candidate" ]; then APP="$candidate"; break; fi
done

if [ -z "$APP" ]; then
  say "${RED}✗ 还没有找到已安装的 MQ Studio。${OFF}"
  say "${RED}✗ MQ Studio is not installed yet.${OFF}"
  say ""
  say "  请先把窗口里的 MQ Studio 拖到 Applications，再回来双击本文件。"
  say "  Drag MQ Studio into Applications first, then run this again."
  say ""
  exit 1
fi

say "找到 / Found:  $APP"
say ""

if ! xattr -dr com.apple.quarantine "$APP" 2>/dev/null; then
  say "${RED}✗ 无法修改该 App，可能是权限不足。${OFF}"
  say "${RED}✗ Could not update the app - most likely a permissions problem.${OFF}"
  say ""
  say "  请在终端里执行 / Run this in Terminal:"
  say "    sudo xattr -dr com.apple.quarantine \"$APP\""
  say ""
  exit 1
fi

# A successful clear means the attribute is gone, so reading it must now fail.
if xattr -p com.apple.quarantine "$APP" >/dev/null 2>&1; then
  say "${RED}✗ 隔离属性仍然存在，请手动执行 / Quarantine flag is still set, run manually:${OFF}"
  say "    sudo xattr -dr com.apple.quarantine \"$APP\""
  say ""
  exit 1
fi

say "${GREEN}✓ 完成，正在启动 MQ Studio…${OFF}"
say "${GREEN}✓ Done. Launching MQ Studio…${OFF}"
say ""
say "${DIM}这一步只需做一次。可以关闭本窗口并推出磁盘映像了。${OFF}"
say "${DIM}This is a one-time step. You can close this window and eject the disk image.${OFF}"
say ""

open "$APP"
