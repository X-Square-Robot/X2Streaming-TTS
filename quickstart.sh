#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${X2_PYTHON:-python3}" "$ROOT/tools/quickstart/launch.py" "$@"
