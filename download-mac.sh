#!/bin/bash
set -euo pipefail
package_dir="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js for macOS ARM64 first.' >&2
  exit 1
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo 'Usage: bash download-mac.sh /path/to/product.json [/path/to/outputs]' >&2
  exit 1
fi
source_path="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]));' "$1")"
output_root="$(node -e 'process.stdout.write(require("path").resolve(process.argv[1]));' "${2:-$package_dir/outputs}")"
cd "$package_dir"
offer_id="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const u=new URL(d.url); const m=u.pathname.match(/^\/offer\/(\d+)\.html$/); if(u.hostname!=="detail.1688.com"||!m) throw Error("Invalid offer URL"); process.stdout.write(m[1]);' "$source_path")"
mkdir -p "$output_root/$offer_id"
if [ "$source_path" -ef "$output_root/$offer_id/source.json" ]; then
  :
else
  cp "$source_path" "$output_root/$offer_id/source.json"
fi
node work/download-assets.mjs "$output_root/$offer_id/source.json" "$output_root"
archive="$output_root/1688_${offer_id}_assets.zip"
temporary_archive="$output_root/1688_${offer_id}_assets.$$.zip"
(cd "$output_root/$offer_id" && /usr/bin/zip -qr "$temporary_archive" .)
mv "$temporary_archive" "$archive"
echo "Saved: $archive"
