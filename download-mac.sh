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
output_name="$(node --input-type=module -e 'import fs from "node:fs"; import {productSourceFromUrl} from "./work/product-identity.mjs"; const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(productSourceFromUrl(d.url).outputName);' "$source_path")"
download_status=0
node work/prepare-materials.mjs "$source_path" "$output_root" || download_status=$?
if [ "$download_status" -ne 0 ]; then
  echo "Preview: $output_root/$output_name/图文预览.html" >&2
  exit "$download_status"
fi
if [ "$zip_requested" != true ]; then
  echo "Preview: $output_root/$output_name/图文预览.html"
  exit 0
fi
case "$output_name" in
  pdd-*) archive_name="pdd_${output_name#pdd-}_assets" ;;
  *) archive_name="1688_${output_name}_assets" ;;
esac
archive="$output_root/$archive_name.zip"
temporary_archive="$output_root/$archive_name.$$.zip"
(cd "$output_root/$output_name" && /usr/bin/zip -qr "$temporary_archive" .)
mv "$temporary_archive" "$archive"
echo "Saved: $archive"
