import { createRequire } from "node:module"
import * as loroCrdt from "loro-crdt"
import * as loroJs from "loro.js"
import type { Engine } from "../src/engine.ts"
import { jsEngine, type LoroJsModule } from "../src/js-engine.ts"

const versionOf = (pkg: string): string => createRequire(import.meta.url)(`${pkg}/package.json`).version

export const engines: Record<string, Engine> = {
  "loro-crdt": jsEngine("loro-crdt", versionOf("loro-crdt"), loroCrdt),
  "loro.js": jsEngine("loro.js", versionOf("loro.js"), loroJs as unknown as LoroJsModule),
}

export const engineNamed = (name: string) => {
  const engine = engines[name]
  if (engine === undefined) throw new Error(`unknown engine ${name}; expected one of ${Object.keys(engines).join(", ")}`)
  return engine
}
