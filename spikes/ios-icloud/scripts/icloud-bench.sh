#!/usr/bin/env bash
# Runs on the Mac. Builds vaultctl, then runs every real-iCloud measurement and prints one JSON object.
# Usage: bash scripts/icloud-bench.sh [probe|latency|names|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")/.."

icloud="$HOME/Library/Mobile Documents/com~apple~CloudDocs/seqno-spike/ios-icloud"
local_dir="$PWD/scratch"
mkdir -p "$icloud" "$local_dir"
swift build -c release --package-path cli > /dev/null
vaultctl=cli/.build/release/vaultctl
what=${1:-all}

run() { [ "$what" = all ] || [ "$what" = "$1" ]; }

{
  echo '{'
  sep=''
  if run probe; then printf '%s"probe": %s\n' "$sep" "$("$vaultctl" probe "$icloud")"; sep=','; fi
  if run latency; then
    printf '%s"latencyLocalAPFS": %s\n' "$sep" "$("$vaultctl" latency "$local_dir" --count 40)"; sep=','
    printf '%s"latencyICloud": %s\n' "$sep" "$("$vaultctl" latency "$icloud" --count 40)"
  fi
  if run names; then
    printf '%s"namesLocalAPFS": %s\n' "$sep" "$("$vaultctl" names "$local_dir")"; sep=','
    printf '%s"namesICloud": %s\n' "$sep" "$("$vaultctl" names "$icloud")"
  fi
  echo '}'
}
