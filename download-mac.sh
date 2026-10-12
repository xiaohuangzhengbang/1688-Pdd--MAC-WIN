#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js for macOS ARM64 first.' >&2
  exit 1
fi
if [ "$#" -ne 1 ]; then
  echo 'Usage: bash download-mac.sh /path/to/product.json' >&2
  exit 1
fi
source_path="$1"
offer_id="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const u=new URL(d.url); const m=u.pathname.match(/^\/offer\/(\d+)\.html$/); if(u.hostname!=="detail.1688.com"||!m) throw Error("Invalid offer URL"); process.stdout.write(m[1]);' "$source_path")"
mkdir -p "outputs/$offer_id"
if [ "$source_path" -ef "outputs/$offer_id/source.json" ]; then
  :
else
  cp "$source_path" "outputs/$offer_id/source.json"
fi
node work/download-assets.mjs "outputs/$offer_id/source.json"
archive="$(pwd)/outputs/1688_${offer_id}_assets.zip"
temporary_archive="$(pwd)/outputs/1688_${offer_id}_assets.$$.zip"
(cd "outputs/$offer_id" && /usr/bin/zip -qr "$temporary_archive" .)
mv "$temporary_archive" "$archive"
echo "Saved: $archive"
