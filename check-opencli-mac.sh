#!/bin/bash
set -euo pipefail
if ! command -v opencli >/dev/null 2>&1; then
  printf '%s\n' 'OpenCLI executable not found on PATH.' 'A Codex plugin entry alone does not prove the local OpenCLI runtime is available.' >&2
  exit 1
fi
printf '%s\n' 'OpenCLI executable:'
command -v opencli
printf '%s\n' 'Installed version:'
opencli --version
printf '%s\n' 'Registered command inventory (metadata only):'
opencli list
printf '%s\n' 'No product command was executed. Browser Bridge connection, login, and site permission have NOT been verified.'
