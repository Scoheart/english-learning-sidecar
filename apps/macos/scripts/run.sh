#!/bin/bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
bash "$HERE/scripts/build-app.sh" "$@"
open "$HERE/dist/English Sidecar.app"
