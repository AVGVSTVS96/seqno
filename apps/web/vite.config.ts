import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { execFileSync } from "node:child_process"
import { defineConfig } from "vite"

const revision =
  process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ??
  execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: { alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/web" }] },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm", "loro-crdt"] },
  worker: { format: "es" },
  build: { target: "esnext" },
  define: { "import.meta.env.VITE_SEQNO_REVISION": JSON.stringify(revision) },
})
