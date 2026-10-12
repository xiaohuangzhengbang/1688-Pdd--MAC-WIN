#!/bin/bash
set -euo pipefail
package_dir="$(cd "$(dirname "$0")" && pwd)"
for required_command in node npx codex; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Missing command: $required_command. Install Node.js ARM64 and Codex CLI, then retry." >&2
    exit 1
  fi
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<12)) throw Error("Node.js 22.12+ required");'
npx_path="$(command -v npx)"
node -e 'const fs=require("fs"),p=require("path");const f=p.join(process.argv[1],".mcp.json");const d=JSON.parse(fs.readFileSync(f,"utf8"));const server=d.mcpServers["chrome-devtools"];server.command=process.argv[2];server.env={...server.env,PATH:p.dirname(process.execPath)+p.delimiter+process.env.PATH};fs.writeFileSync(f,JSON.stringify(d,null,2)+"\n");' "$package_dir" "$npx_path"
codex plugin marketplace add "$package_dir" --json
codex plugin add 1688-fast-assets@1688-mac-portable --json
printf '%s\n' 'Plugin installed. Restart Codex. In Chrome enable remote debugging at chrome://inspect/#remote-debugging and approve the connection. Browser connection still needs verification.'
