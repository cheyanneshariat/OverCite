#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
node texstudio/scripts/install.mjs "$@"
