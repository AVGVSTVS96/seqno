import { defineConfig } from "vite"

const crossOriginIsolated = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
}

export default defineConfig({
  resolve: { alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/web" }] },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm", "loro-crdt"] },
  build: { target: "esnext" },
  preview: { headers: crossOriginIsolated },
  server: { headers: crossOriginIsolated },
})
