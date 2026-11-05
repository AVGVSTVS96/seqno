import react from "@vitejs/plugin-react"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { defineConfig, type Plugin } from "vite-plus"
import { fetchCommits } from "./src/github.ts"

const prerendered = resolve(import.meta.dirname, "node_modules/.prerender")

function prerender(): Plugin {
  return {
    name: "seqno:prerender",
    config: () => ({
      environments: {
        ssr: { build: { ssr: "src/render.tsx", outDir: prerendered, emptyOutDir: true } },
      },
      builder: {
        async buildApp(builder) {
          for (const name of ["ssr", "client"]) {
            const environment = builder.environments[name]
            if (environment) await builder.build(environment)
          }
          await rm(prerendered, { recursive: true, force: true })
        },
      },
    }),
    transformIndexHtml: {
      order: "post",
      async handler(html, { server }) {
        if (server) return html
        const { render } = await import(pathToFileURL(resolve(prerendered, "render.js")).href)
        return html.replace("<!--app-->", render())
      },
    },
  }
}

function siteUrl(): Plugin {
  const host = process.env["VERCEL_PROJECT_PRODUCTION_URL"]
  const url = process.env["SITE_URL"] ?? (host ? `https://${host}` : "")
  return {
    name: "seqno:site-url",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", url),
  }
}

export default defineConfig(async () => {
  const token = process.env["GITHUB_TOKEN"]
  const { count } = await fetchCommits(
    token ? { headers: { authorization: `Bearer ${token}` } } : {},
  ).catch((error: unknown) => {
    throw new Error(
      `Couldn't read seqno's commit count from GitHub (${String(error)}). Set GITHUB_TOKEN if it's rate limiting.`,
    )
  })
  return {
    plugins: [react(), prerender(), siteUrl()],
    define: { __COMMIT_COUNT__: String(count) },
    server: { proxy: { "/app": { target: "https://seqno.vercel.app", changeOrigin: true } } },
    build: { target: "es2022", assetsInlineLimit: 0 },
    fmt: { semi: false },
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
    },
  }
})
