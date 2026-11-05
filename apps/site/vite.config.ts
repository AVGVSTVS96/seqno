import react from "@vitejs/plugin-react"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { defineConfig } from "vite"
import type { Plugin } from "vite"
import { fetchCommits } from "./src/github.ts"
import type * as Render from "./src/render.tsx"

const prerendered = resolve(import.meta.dirname, "node_modules/.prerender")

const isRenderModule = (built: unknown): built is typeof Render =>
  typeof built === "object" &&
  built !== null &&
  "render" in built &&
  typeof built.render === "function"

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

            if (environment) {
              await builder.build(environment)
            }
          }

          await rm(prerendered, { recursive: true, force: true })
        },
      },
    }),
    transformIndexHtml: {
      order: "post",
      async handler(html, { server }) {
        if (server) {
          return html
        }

        const built: unknown = await import(pathToFileURL(resolve(prerendered, "render.js")).href)

        if (!isRenderModule(built)) {
          throw new Error("The prerender build has no render function.")
        }

        return html.replace("<!--app-->", built.render())
      },
    },
  }
}

function siteUrl(): Plugin {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const url = process.env.SITE_URL ?? (host === undefined || host === "" ? "" : `https://${host}`)

  return {
    name: "seqno:site-url",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", url),
  }
}

async function commitCount() {
  const token = process.env.GITHUB_TOKEN

  try {
    const { count } = await fetchCommits(
      token === undefined || token === "" ? {} : { headers: { authorization: `Bearer ${token}` } },
    )

    return count
  } catch (error) {
    throw new Error(
      `Couldn't read seqno's commit count from GitHub (${String(error)}). Set GITHUB_TOKEN if it's rate limiting.`,
      { cause: error },
    )
  }
}

export default defineConfig(async () => {
  const count = await commitCount()

  return {
    plugins: [react(), prerender(), siteUrl()],
    define: { __COMMIT_COUNT__: String(count) },
    server: { proxy: { "/app": { target: "https://seqno.vercel.app", changeOrigin: true } } },
    build: { target: "es2022", assetsInlineLimit: 0 },
  }
})
