# ios-icloud spike: results

**Verdict:** the file layer works. Everything we can test without Apple's help works: coordinated
atomic writes, coordinated reads, listings that report download status from resource keys,
eviction, download, and change watching. It works from JS on the iOS 27 simulator (Expo SDK 57),
and the same Swift code works against real iCloud Drive on macOS 26.6.1.
**Blocked:** an iOS app can't use iCloud until we have a paid Apple Developer Program team. Unblock steps are at the bottom.

All timings are preliminary (the machines were shared). Two runs each.

## Numbers

### Real iCloud Drive, macOS 26.6.1 (`vaultctl`, same `VaultCore.swift` as the iOS module)

| what | run 1 | run 2 |
|---|---|---|
| coordinated atomic write, 4 KB, p50 / p95 | 8.1 / 85.7 ms | 7.7 / 22.6 ms |
| 200 overwrites of one file, p50 / p95 | 4.8 / 10.4 ms | 4.6 / 9.2 ms |
| 300 new files, total write time | 1.65 s | 2.15 s |
| coordinated read, 4 KB, p50 / p95 (plain read is ~0 ms) | 3.0 / 17 ms | 3.6 / 9.7 ms |
| write → `isUploading`, p50 / p95 | 0.26 / 0.67 s | 0.96 / 2.0 s |
| write → `isUploaded`, p50 / p95 (20 files, 200 ms apart) | 15.7 / 17.9 s | 12.1 / 13.8 s |
| last of 300 new files → all uploaded | 39.8 s | 32.4 s |
| last of 200 overwrites → uploaded | 7.2 s | 11.5 s |
| write → NSFilePresenter event in another process, p50 / p95 | 0.49 / 1.10 s | 0.66 / 1.09 s |
| same on a plain local APFS folder | 1.09 / 1.10 s | 1.08 / 1.11 s |
| evict (`brctl evict` or `evictUbiquitousItem`) | 0.52–0.60 s | 0.52–1.34 s |
| evict → status reads `notDownloaded` | < 15 ms | < 15 ms |
| `startDownloadingUbiquitousItem` → `current` | 0.24–0.36 s | 0.30–0.62 s |
| reading an evicted file (coordinated or plain) | 0.79–0.86 s, bytes match | 0.86–0.89 s, bytes match |
| NSMetadataQuery, path scope, no entitlement | 0 of 20 events | 0 of 20 events |

### iOS 27.0 simulator, Expo SDK 57 / RN 0.86.3, called from JS

| what (ranges over 2 runs each) | Release (embedded JS) | Debug (expo-dev-client + Metro) |
|---|---|---|
| e2e checks | 9 / 9, 9 / 9 | 9 / 9, 9 / 9 |
| coordinated atomic write, 4–12 KB | 2.7–5.2 ms | 2.5–5.6 ms |
| 200 overwrites, p50 / p95 | 2.6–2.7 / 3.5–3.6 ms | 2.7–3.9 / 3.6–7.9 ms |
| 200 concurrent new-file writes, total | 0.49–0.54 s | 0.51–0.93 s |
| NSFilePresenter event latency (new / overwrite / delete) | 1.08–1.11 s | 1.09–1.10 s |
| 24↔32 MB atomic overwrites: partial sizes seen by stat or coordinated read | none | none |

The same app also builds and passes 9/9 with the iCloud entitlements turned on (`SEQNO_ICLOUD=1`,
ad-hoc signed). It reports `ubiquityIdentityToken = nil` because no account is signed in.

## What we learned

**Placeholders on macOS 26 are dataless files, not `.icloud` stubs.** An evicted file keeps its
real name and its logical size (4096). It shows `blocks=0`, `flags=compressed,dataless`, and
resource keys report `downloadingStatus=notDownloaded, isUploaded=true`. No `.name.icloud` file
appears. `brctl evict` still works, even though `brctl --help` no longer lists it.

**Reading an evicted file downloads it.** Both coordinated and plain reads block for about 0.8 s
and then return the right bytes. So the app must check `downloadingStatus` before it reads on any
latency-sensitive path. Evicted files you don't touch stay evicted.

**NSFilePresenter is the watcher that works without an entitlement, but it is coarse:**
- every event arrives as `presentedSubitemDidChange`, including new files and deletes.
  `didAppear` and `accommodateSubitemDeletion` never fired on iOS or macOS.
- there is a fixed delay of about 1.1 s. On iCloud, some events come sooner (20–750 ms). The likely
  cause is that the sync engine's own coordinated reads trigger them.
- bursts get merged: 200 overwrites produced 0–2 events.
- downloading an evicted file produced no event.

So treat each event as "re-check this path" and rescan resource keys. Never count events.

**NSMetadataQuery needs the iCloud entitlement.** With a path scope on macOS, and on iOS without an
entitlement, it finishes gathering and then never sends updates. We need the entitlement before we
can test its download-status updates.

**Unicode filenames: Foundation writes NFD, and iCloud keeps whatever bytes it gets.**

| writer | NFC name ends up on disk as | NFD name ends up on disk as |
|---|---|---|
| Foundation, URL-based (`FileManager`, `Data.write`, our module) | **NFD** | NFD |
| POSIX `open()` with a String path | NFC | NFD |

- The same results hold on local APFS and in iCloud Drive, before upload, while evicted, and after
  re-download. So the decomposition comes from Foundation, not from iCloud.
- Lookups ignore normalization: an NFC file opens through an NFD path. Writing `x-é` as NFC and then
  as NFD gives one file, stored as NFD.
- Swift `String` treats NFC == NFD as equal. JS does not.
- Policy: keep sync-critical names ASCII (`updates/<deviceId>/<n>.loro` and `snapshots/<hash>.loro`
  already are). NFC-normalize page names when indexing `mirror/*.md`. Never byte-compare names
  from a directory listing.

**Partial writes:**
- A non-atomic 32 MB write let readers see 31 partial sizes (stat and coordinated reads alike).
  iCloud also started uploading before the write finished.
- An atomic write (temp file + `replaceItemAt`/move inside a coordinated `.forReplacing` write)
  never exposed a partial file, on macOS or on iOS.
- So the module only writes atomically.

**Rapid writes:**
- Last write wins (`v199` of 200).
- No temp files are left behind (300 of 300).
- iCloud batches the uploads.

**Conflicts:** `NSFileVersion.unresolvedConflictVersionsOfItem` runs and reports 0 locally.
We can't create a real conflict without a second iCloud device. Note that with one writer per file
(`updates/<deviceId>/`), conflicts should only ever hit `mirror/` if the designated writer changes.

**iOS 27 needs the UIScene lifecycle:**
- An app built with the iOS 27 SDK that doesn't adopt scenes traps at launch
  (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`).
- The SDK 57 template doesn't adopt scenes. The SDK 58 template does.
- `app.config.ts` ports that change with a small inline config plugin. It uses expo's built-in
  `EXExpoAppSceneDelegate`, so no extra native files are needed.
- Any other Expo SDK 57 app on the iOS 27 simulator will hit this too.

**A transient upload error:** once, right after a write, `ubiquitousItemUploadingError` said
"Couldn't access your iCloud account". The file uploaded about 15 s later anyway, so the app should
not treat that error as fatal.

## Rerun

From Linux, push the code first: `bash ~/dev/seqno/spikes/ios-icloud/scripts/sync-to-mac.sh`

| benchmark | command (prints JSON) |
|---|---|
| real iCloud: probe + latency + Unicode | `ssh mac 'cd ~/Developer/seqno-spikes/ios-icloud && bash scripts/icloud-bench.sh'` |
| only one part | `... bash scripts/icloud-bench.sh probe` (or `latency`, `names`) |
| iOS 27 sim e2e, Release | `ssh mac 'cd ~/Developer/seqno-spikes/ios-icloud && bash scripts/sim-e2e.sh'` |
| iOS 27 sim e2e, dev client + Metro | `ssh mac 'cd ~/Developer/seqno-spikes/ios-icloud && CONFIGURATION=Debug bash scripts/sim-e2e.sh'` |

All runs are headless: `simctl` and `xcodebuild` only, and Metro runs headless on port 8097. Seeds
are fixed. Tests write only inside `iCloud Drive/seqno-spike/ios-icloud/` and remove their own
folders. Raw outputs from this session are in `results/`.

## Layout

- `app/modules/seqno-vault/ios/VaultCore.swift`: all the file logic (coordination, resource keys,
  eviction and download, NSFileVersion, NSFilePresenter + NSMetadataQuery watcher).
  The CLI shares this file through a symlink.
- `app/modules/seqno-vault/ios/SeqnoVaultModule.swift`: the Expo Modules API surface
  (`writeAtomic`, `read`, `remove`, `list`, `status`, `rawNames`, `startDownloading`, `evict`,
  `conflicts`, `resolveConflicts`, `watch`/`unwatch` → `onVaultEvent`).
- `app/src/suite.ts`: the JS e2e suite. The app writes `Documents/e2e-results.json`.
- `cli/`: `vaultctl` (SwiftPM). Subcommands: `probe | latency | names | watch | ls | raw | status | read | write | evict | download | conflicts`.

## Decision needed: where `iCloud Drive/seqno/` lives

iOS apps can't open the iCloud Drive root. That leaves two ways to reach the graph:

| | A. the app's own container (recommended) | B. a folder the user picks |
|---|---|---|
| on disk (Mac) | `~/Library/Mobile Documents/iCloud~<container>/Documents/<graph>/`, which Finder shows as "iCloud Drive › seqno" (`NSUbiquitousContainerIsDocumentScopePublic`) | `~/Library/Mobile Documents/com~apple~CloudDocs/seqno/<graph>/` |
| iOS access | always available | document picker + security-scoped bookmark, re-granted when the bookmark goes stale |
| watching | NSMetadataQuery ubiquitous-documents scope + NSFilePresenter | NSFilePresenter; external-documents query scope |
| needs ADP | yes (iCloud entitlement) | probably not for dev builds: no iCloud entitlement is needed and the Files app does the syncing. A free Personal Team can install on one's own iPhone (7-day profiles). App Store shipping needs ADP either way. **Untested.** |

Option A matches the "iCloud Drive/seqno" layout and is the simplest to watch. The Mac, web and
Electron code then point at the container's `Documents` folder, not at `com~apple~CloudDocs/seqno`.
Option B could be tried on a physical iPhone before ADP enrollment. It needs a person to add their
account in Xcode for a Personal Team, and the iPhone connected to the Mac.

## Blocked: what Apple requires

| question | answer | source |
|---|---|---|
| Paid Apple Developer Program needed? | **Yes.** "iCloud: iCloud documents" is available to ADP and ADEP members only. | developer.apple.com/help/account/reference/supported-capabilities-ios |
| Is a free Personal Team enough? | **No.** The free "Apple Developer" column has App Groups, Background Modes, Data Protection, HealthKit, HomeKit, Keychain Sharing, Maps, and a few others, but no iCloud. | same page |
| Can the simulator skip all this? | Only the build. A simulator build with the entitlements is ad-hoc signed with `application-identifier = FAKETEAMID.com.seqno.spike.vault`. The container must be registered to a real team, which Xcode does in the developer account. | our build + developer.apple.com/documentation/xcode/configuring-icloud-services |
| iCloud sign-in on the simulator? | Possible, but a person has to do it in the simulator's Settings app (UI). Agents may not sign in. Forum reports say the iCloud Drive switch won't stay on in **iOS 27** simulators with Xcode 27 RC 27A266a (our build). The iOS 26.x simulator still works, and iOS 26.3 is installed. Headless sync trigger: `xcrun simctl icloud_sync <udid>`. | developer.apple.com/forums/thread/845155 |

**Steps to unblock (in order):**
1. Enroll in the Apple Developer Program (99 USD/yr, individual or organization) with the Apple
   Account that should own seqno.
2. On the Mac, a person does this once in the GUI: Xcode → Settings → Accounts → add that account.
   This creates the Apple Development certificate in the login keychain. Agents may not touch
   accounts or the keychain.
3. Choose the final bundle ID and container (for example `app.seqno` and `iCloud.app.seqno`).
   **Container IDs can't be deleted once created.** Then share the 10-character Team ID.
4. Build: `SEQNO_ICLOUD=1` prebuild, then `xcodebuild ... DEVELOPMENT_TEAM=<TEAMID> -allowProvisioningUpdates`
   (instead of `CODE_SIGN_IDENTITY=-`). With automatic signing, Xcode registers the App ID and the
   container.
5. Get a second iCloud device for the remaining tests (conflict versions, remote → local
   watcher latency, NSMetadataQuery download status, and whether iOS still shows `.icloud` stubs):
   - **Option A:** a physical iPhone with iCloud Drive on (Xcode registers its UDID to the team).
   - **Option B:** an iOS 26.3 simulator that a person has signed in to a test Apple Account once.
