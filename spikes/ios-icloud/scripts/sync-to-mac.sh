#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ssh mac 'mkdir -p ~/Developer/seqno-spikes/ios-icloud'
rsync -a --delete \
  --exclude node_modules --exclude /app/ios --exclude /app/build --exclude /app/.expo \
  --exclude /cli/.build --exclude /scratch --exclude '/results*' --exclude '*.err' --exclude '*.log' \
  "$here/" mac:Developer/seqno-spikes/ios-icloud/
