import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { execFileSync } from "node:child_process"
import { defineConfig } from "vite"
import { offline } from "./offline.ts"
import { pdfjsAssets } from "./pdfjs.ts"
import { viewer } from "./viewer.ts"

const revision =
  process.env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) ??
  execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf-8" }).trim()

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    viewer(),
    offline(),
    pdfjsAssets(),
  ],
  resolve: { alias: [{ find: /^loro-crdt$/u, replacement: "loro-crdt/web" }] },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm", "loro-crdt"] },
  worker: { format: "es" },
  build: { target: "esnext" },
  define: { "import.meta.env.VITE_SEQNO_REVISION": JSON.stringify(revision) },
})
