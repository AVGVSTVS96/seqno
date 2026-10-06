import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: { alias: [{ find: /^loro-crdt$/, replacement: "loro-crdt/web" }] },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm", "loro-crdt"] },
  worker: { format: "es" },
  build: { target: "esnext" },
})
