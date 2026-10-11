import { transformAsync } from "@babel/core"
import reactCompiler, { type LoggerEvent } from "babel-plugin-react-compiler"
import { globSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { transformWithOxc } from "vite"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const components = globSync(["apps/web/src/**/*.tsx", "features/*/src/**/*.tsx"], { cwd: root })

const skipped = async (path: string) => {
  const { code } = await transformWithOxc(readFileSync(`${root}${path}`, "utf8"), path, {
    jsx: "preserve",
    lang: "tsx",
  })
  const errors: Array<string> = []
  const logEvent = (_: string | null, event: LoggerEvent) => {
    if (event.kind === "CompileError") {
      errors.push(`${path}:${event.fnLoc?.start.line ?? 0} ${event.detail.reason}`)
    }
  }
  await transformAsync(code, {
    filename: path.replace(/\.tsx$/, ".jsx"),
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx"] },
    plugins: [[reactCompiler, { logger: { logEvent } }]],
  })
  return errors
}

describe("React Compiler", () => {
  it("compiles every component", async () => {
    expect(components.length).toBeGreaterThan(40)
    expect((await Promise.all(components.map(skipped))).flat()).toEqual([])
  })
})
