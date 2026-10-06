import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const APP_DIR = join(ROOT, "app")
const BUILT_APP = join(ROOT, "dd", "Build", "Products", "Release-iphonesimulator", "iosloro.app")
const BUNDLE_ID = "dev.seqno.iosloro"
const DEVICE_NAME = "seqno-ios-loro"
const DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-27-0"
const FIXTURE = "graph-20261006-50000"
const TIMEOUT_MS = 20 * 60_000

const sh = (cmd: string, args: readonly string[], opts: { cwd?: string; quiet?: boolean } = {}) =>
  execFileSync(cmd, args, { cwd: opts.cwd, encoding: "utf8", stdio: ["ignore", "pipe", opts.quiet ? "ignore" : "inherit"], maxBuffer: 1 << 28 })
const simctl = (...args: string[]) => sh("xcrun", ["simctl", ...args])
const attempt = (f: () => unknown) => {
  try {
    f()
  } catch {}
}
const log = (msg: string) => process.stderr.write(`[ios-loro] ${msg}\n`)

const device = () => {
  const { devices } = JSON.parse(simctl("list", "devices", "-j")) as { devices: Record<string, { name: string; udid: string }[]> }
  const found = (devices[RUNTIME] ?? []).find((d) => d.name === DEVICE_NAME)
  const udid = found?.udid ?? simctl("create", DEVICE_NAME, DEVICE_TYPE, RUNTIME).trim()
  try {
    simctl("bootstatus", udid, "-b")
  } catch {
    simctl("boot", udid)
    simctl("bootstatus", udid, "-b")
  }
  return udid
}

const build = () => {
  const ios = join(APP_DIR, "ios")
  const step = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: ["ignore", process.stderr, "inherit"], env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } })
  if (!existsSync(ios)) step("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--clean", "--no-install"], APP_DIR)
  if (!existsSync(join(ios, "iosloro.xcworkspace"))) step("pod", ["install"], ios)
  const logFile = join(ROOT, "xcodebuild.log")
  log(`xcodebuild Release (iphonesimulator, arm64) -> ${logFile}`)
  try {
    execFileSync(
      "sh",
      [
        "-c",
        `xcodebuild -workspace iosloro.xcworkspace -scheme iosloro -configuration Release -sdk iphonesimulator ` +
          `-destination "generic/platform=iOS Simulator" -derivedDataPath ../../dd ARCHS=arm64 ONLY_ACTIVE_ARCH=NO ` +
          `CODE_SIGNING_ALLOWED=NO build > "${logFile}" 2>&1`,
      ],
      { cwd: join(APP_DIR, "ios"), stdio: "inherit" },
    )
  } catch {
    throw new Error(`xcodebuild failed, see ${logFile}`)
  }
  const udid = device()
  simctl("install", udid, BUILT_APP)
  log(`installed on ${DEVICE_NAME} (${udid})`)
}

const footprint = (pid: number) => {
  const out = sh("footprint", ["-p", String(pid), "-f", "bytes"], { quiet: true })
  const field = (name: string) => {
    const m = out.match(new RegExp(`${name}:\\s*(\\d+)`))
    return m === null ? null : Math.round(Number(m[1]) / 1e5) / 10
  }
  return { physFootprintMB: field("phys_footprint"), physFootprintPeakMB: field("phys_footprint_peak") }
}

const runJob = async (task: "bench" | "crosscheck", engine: string, mode: string) => {
  const udid = device()
  attempt(() => simctl("terminate", udid, BUNDLE_ID))
  const docs = join(simctl("get_app_container", udid, BUNDLE_ID, "data").trim(), "Documents")
  const fixtureDst = join(docs, "fixtures", FIXTURE)
  mkdirSync(fixtureDst, { recursive: true })
  for (const f of ["snapshot.loro", "merge.loro", "merge2.loro", "merge3.loro", "meta.json"]) cpSync(join(ROOT, "fixtures", FIXTURE, f), join(fixtureDst, f))
  rmSync(join(docs, "out"), { recursive: true, force: true })
  const name = task === "bench" ? `${task}-${engine}-${mode}` : `${task}-${engine}`
  const id = `${name}-${Date.now()}`
  writeFileSync(join(docs, "job.json"), JSON.stringify({ id, task, engine, mode, fixture: FIXTURE }))

  const launched = simctl("launch", udid, BUNDLE_ID)
  const pid = Number(launched.trim().split(":").pop())
  log(`launched ${id} pid ${pid}`)
  const memory: Record<string, ReturnType<typeof footprint>> = {}
  const outDir = join(docs, "out")
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`timed out after ${TIMEOUT_MS / 1000}s`)
    const files = existsSync(outDir) ? readdirSync(outDir) : []
    for (const f of files) {
      const m = f.match(/\.checkpoint-(\w+)$/)
      if (m === null || memory[m[1]!] !== undefined) continue
      memory[m[1]!] = footprint(pid)
      writeFileSync(join(outDir, `${id}.ack-${m[1]}`), "")
      log(`checkpoint ${m[1]}: ${JSON.stringify(memory[m[1]!])}`)
    }
    if (files.includes(`${id}.result.json`)) break
    try {
      process.kill(pid, 0)
    } catch {
      throw new Error(`app process ${pid} exited without a result (crash?)`)
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  memory.final = footprint(pid)
  const report = JSON.parse(readFileSync(join(outDir, `${id}.result.json`), "utf8"))
  const resultsDir = join(ROOT, "results", "ios")
  mkdirSync(resultsDir, { recursive: true })
  for (const f of readdirSync(outDir)) if (/\.(state\.json|snapshot\.loro)$/.test(f)) cpSync(join(outDir, f), join(resultsDir, f.replace(id, `${name}-latest`)))
  attempt(() => simctl("terminate", udid, BUNDLE_ID))
  const runtime = JSON.parse(simctl("list", "runtimes", "-j")).runtimes.find((r: { identifier: string }) => r.identifier === RUNTIME)
  const optLevelFile = join(APP_DIR, "node_modules", "loro-react-native", "build", "OPT_LEVEL")
  const rustOptLevel = existsSync(optLevelFile) ? readFileSync(optLevelFile, "utf8").trim() : "z (upstream ubrn build)"
  const full = {
    ...report,
    rustOptLevel,
    device: { name: DEVICE_NAME, type: DEVICE_TYPE, runtime: runtime?.version, host: sh("sysctl", ["-n", "machdep.cpu.brand_string"]).trim() },
    memory,
  }
  writeFileSync(join(resultsDir, `${name}-latest.json`), JSON.stringify(full, null, 2))
  return full
}

const [command = "bench", engine = "loro-react-native", mode = "full"] = process.argv.slice(2)
if (command === "build") build()
else if (command === "bench" || command === "crosscheck") console.log(JSON.stringify(await runJob(command, engine, mode), null, 2))
else throw new Error(`usage: node host/run.ts build | bench <engine> [full|lazy] | crosscheck <engine>`)
