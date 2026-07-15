#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(dirname "$script_dir")"
resources="$repo_root/desktop/resources"
source_icon="$resources/icon-source.png"
output_png="$resources/icon.png"

magick="$(command -v magick || true)"
if [ -z "$magick" ]; then
  echo "生成图标需要 ImageMagick（magick）。" >&2
  exit 1
fi

# macOS 的标准图标画布需要保留视觉安全边距，避免 Dock 中显得比其他应用更大。
"$magick" "$source_icon" -resize 824x824 -gravity center -background none -extent 1024x1024 "$output_png"
"$magick" "$output_png" -define icon:auto-resize=256,128,64,48,32,16 "$resources/icon.ico"
node "$script_dir/generate-icns.mjs" "$output_png" "$resources/icon.icns"
