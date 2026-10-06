import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { CROSSCHECK, runCrosscheck, stateDigest } from "../src/crosscheck.ts"
import { engineNamed } from "./engines.ts"
import { prepareFixture } from "./prep.ts"

const iosEngine = process.argv[2] ?? "loro-react-native"
const results = join(import.meta.dirname, "..", "results")
const MAC_DIR = "Developer/seqno-spikes/ios-loro"
mkdirSync(join(results, "web"), { recursive: true })
mkdirSync(join(results, "ios"), { recursive: true })

const { dir } = await prepareFixture(CROSSCHECK.graphSeed, CROSSCHECK.blocks)
const web = await runCrosscheck(engineNamed("loro-crdt"), readFileSync(join(dir, "snapshot.loro")))
const { state: webState, snapshot: webSnapshot, ...webSummary } = web
writeFileSync(join(results, "web", "crosscheck-loro-crdt.json"), JSON.stringify(webSummary, null, 2))
writeFileSync(join(results, "web", "crosscheck-loro-crdt.snapshot.loro"), webSnapshot)

const ios = JSON.parse(
  execFileSync("ssh", ["mac", `cd ~/${MAC_DIR} && node host/run.ts crosscheck ${iosEngine}`], { encoding: "utf8", maxBuffer: 1 << 26 }),
)
if (!ios.ok) throw new Error(`iOS crosscheck failed: ${ios.error}`)
for (const ext of ["state.json", "snapshot.loro"])
  execFileSync("scp", ["-q", `mac:${MAC_DIR}/results/ios/crosscheck-${iosEngine}-latest.${ext}`, join(results, "ios", `crosscheck-${iosEngine}.${ext}`)])
const iosState = JSON.parse(readFileSync(join(results, "ios", `crosscheck-${iosEngine}.state.json`), "utf8"))
const iosSnapshot = readFileSync(join(results, "ios", `crosscheck-${iosEngine}.snapshot.loro`))

const reimported = engineNamed("loro-crdt").createDoc()
reimported.importBytes(iosSnapshot)
const r = ios.result
const checks = {
  sameEdits: r.editsDigest === web.editsDigest,
  identicalVersionVector: isDeepStrictEqual(r.version, web.version),
  identicalFrontiers: isDeepStrictEqual(r.frontiers, web.frontiers),
  deepEqualState: isDeepStrictEqual(iosState, webState),
  iosBlockMapMatchesModel: r.blockMapDigest === r.modelDigest,
  webBlockMapMatchesModel: web.blockMapDigest === web.modelDigest,
  iosSnapshotImportsOnWeb: isDeepStrictEqual(reimported.toJSON(), webState) && isDeepStrictEqual(reimported.versionJSON(), web.version),
  webSnapshotImportsOnIos: r.modelDigest === web.modelDigest && r.blockMapDigest === r.modelDigest,
}
const report = {
  pass: Object.values(checks).every(Boolean),
  checks,
  params: { ...CROSSCHECK, peer: String(CROSSCHECK.peer) },
  edits: { count: Object.values(web.kinds).reduce((a, b) => a + b, 0), kinds: web.kinds, digest: web.editsDigest },
  web: { engine: `${web.engine}@${web.loro}`, applyMs: web.applyMs, stateDigest: web.stateDigest, version: web.version, snapshotBytes: web.snapshotBytes },
  ios: {
    engine: `${r.engine}@${r.loro}`,
    device: ios.device,
    applyMs: r.applyMs,
    stateDigest: stateDigest(iosState),
    version: r.version,
    snapshotBytes: r.snapshotBytes,
  },
}
writeFileSync(join(results, `crosscheck-${iosEngine}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!report.pass) process.exitCode = 1
