#!/bin/bash
set -euo pipefail
package_dir="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js for macOS ARM64 first.' >&2
  exit 1
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  echo 'Usage: bash download-mac.sh /path/to/product.json [/path/to/outputs] [--zip]' >&2
  exit 1
fi
zip_requested=false
output_selected=false
output_argument="$package_dir/outputs"
for argument in "${@:2}"; do
  if [ "$argument" = '--zip' ]; then
    zip_requested=true
  elif [ "$output_selected" != true ]; then
    output_argument="$argument"
    output_selected=true
  else
    echo 'Only one output directory is accepted.' >&2
    exit 1
  fi
done
source_path="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]));' "$1")"
output_root="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]));' "$output_argument")"
cd "$package_dir"
offer_id="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const u=new URL(d.url); const m=u.pathname.match(/^\/offer\/(\d+)\.html$/); if(u.hostname!=="detail.1688.com"||!m) throw Error("Invalid offer URL"); process.stdout.write(m[1]);' "$source_path")"
mkdir -p "$output_root/$offer_id"
if [ "$source_path" -ef "$output_root/$offer_id/source.json" ]; then
  :
else
  cp "$source_path" "$output_root/$offer_id/source.json"
fi
download_status=0
node work/download-assets.mjs "$output_root/$offer_id/source.json" "$output_root" || download_status=$?
node work/create-preview.mjs "$output_root/$offer_id"
if [ "$download_status" -ne 0 ]; then
  echo "Preview: $output_root/$offer_id/图文预览.html" >&2
  exit "$download_status"
fi
if [ "$zip_requested" != true ]; then
  echo "Preview: $output_root/$offer_id/图文预览.html"
  exit 0
fi
archive="$output_root/1688_${offer_id}_assets.zip"
temporary_archive="$output_root/1688_${offer_id}_assets.$$.zip"
(cd "$output_root/$offer_id" && /usr/bin/zip -qr "$temporary_archive" .)
mv "$temporary_archive" "$archive"
echo "Saved: $archive"
