#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
native/.build/release/human-approval approve "${1:-1}"
