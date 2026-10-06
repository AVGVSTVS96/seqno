#!/usr/bin/env bash
# Builds the Expo SDK 57 app with the SeqnoVault module for the iOS 27 simulator,
# runs the JS end-to-end suite inside it, and prints the suite's JSON report.
# Env: CONFIGURATION=Release|Debug (Debug = expo-dev-client loading JS from a headless Metro), SEQNO_ICLOUD=1 adds iCloud entitlements.
set -euo pipefail
cd "$(dirname "$0")/../app"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

device_name=seqno-ios-icloud
runtime=com.apple.CoreSimulator.SimRuntime.iOS-27-0
bundle_id=com.seqno.spike.vault
configuration=${CONFIGURATION:-Release}
logs=../results/logs
mkdir -p "$logs"

udid=$(xcrun simctl list devices -j | python3 -c "
import json,sys
for rt,devs in json.load(sys.stdin)['devices'].items():
    for d in devs:
        if d['name']=='$device_name' and rt=='$runtime': print(d['udid']); sys.exit()")
[ -n "$udid" ] || udid=$(xcrun simctl create "$device_name" "iPhone 17" "$runtime")
xcrun simctl bootstatus "$udid" -b > /dev/null

pnpm install --frozen-lockfile > "$logs/install.log" 2>&1
CI=1 npx expo prebuild -p ios --clean > "$logs/prebuild.log" 2>&1
workspace=$(ls -d ios/*.xcworkspace | head -1)
scheme=$(basename "$workspace" .xcworkspace)
xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration "$configuration" \
  -sdk iphonesimulator -destination "id=$udid" -derivedDataPath build \
  CODE_SIGN_IDENTITY=- > "$logs/xcodebuild.log" 2>&1 || { tail -40 "$logs/xcodebuild.log" >&2; exit 1; }

app="build/Build/Products/$configuration-iphonesimulator/$scheme.app"
codesign -d --entitlements :- "$app" > "$logs/entitlements.plist" 2>/dev/null || true
xcrun simctl terminate "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl uninstall "$udid" "$bundle_id" 2>/dev/null || true
xcrun simctl install "$udid" "$app"
data=$(xcrun simctl get_app_container "$udid" "$bundle_id" data)
rm -f "$data/Documents/e2e-results.json"
if [ "$configuration" = Debug ]; then
  metro_port=8097
  CI=1 node_modules/.bin/expo start --dev-client --port "$metro_port" > "$logs/metro.log" 2>&1 &
  metro_pid=$!
  stop_metro() {
    lsof -ti "tcp:$metro_port" -sTCP:LISTEN | xargs kill 2>/dev/null || true
    kill "$metro_pid" 2>/dev/null || true
  }
  trap stop_metro EXIT
  until curl -sf "http://localhost:$metro_port/status" > /dev/null; do sleep 1; done
  xcrun simctl launch "$udid" "$bundle_id" \
    -expo.devlauncher.hasGrantedNetworkPermission YES --initialUrl "http://localhost:$metro_port" > /dev/null
else
  xcrun simctl launch "$udid" "$bundle_id" > /dev/null
fi

for _ in $(seq 1 240); do
  [ -s "$data/Documents/e2e-results.json" ] && break
  sleep 1
done
xcrun simctl io "$udid" screenshot "$logs/screenshot-$configuration.png" > /dev/null 2>&1 || true
[ -s "$data/Documents/e2e-results.json" ] || { echo '{"error":"no results after 240s"}'; exit 1; }
cat "$data/Documents/e2e-results.json"
