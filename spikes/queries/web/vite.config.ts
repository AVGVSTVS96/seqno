import { defineConfig } from "vite"

export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: "dist", emptyOutDir: true, target: "es2023" },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  logLevel: "warn",
})
