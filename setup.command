#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
swift build --package-path native -c release
if [[ ! -f .state/enclave-key ]]; then
  native/.build/release/human-approval enroll
fi
npm run setup
