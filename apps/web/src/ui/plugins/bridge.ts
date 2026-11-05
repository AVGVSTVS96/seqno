import { Effect, Option, Schema } from "effect"
import { GitClient } from "@seqno/rpc"
import { AsyncResult, AtomRegistry } from "effect/reactivity"
import { BlockId, normalizePageName } from "@seqno/domain"
import { editingBlock } from "@seqno/editor"
import { coreRuntime, editRequest } from "@seqno/outliner"
import type { Bridge, Route } from "@seqno/plugins"
import {
  allPages,
  leftSidebarOpen,
  openGraph,
  pages,
  resolvedTheme,
  showBrackets,
  rightSidebar,
} from "../../atoms.ts"
import type { router as appRouter } from "../../router.tsx"
import { assetBridge } from "../assets.ts"
import { runGit } from "../shell/Git.tsx"
import { notify } from "../shell/Notices.tsx"

const blockIdOf = Schema.decodeUnknownOption(BlockId)

export const routeOf = (path: string): Route => {
  const page = /^\/page\/([^/?#]+)/.exec(path)

  if (path === "/" || path === "") {
    return { _tag: "Journals" }
  }

  if (page?.[1] !== undefined) {
    return { _tag: "Page", name: decodeURIComponent(page[1]) }
  }

  if (path === "/all-pages") {
    return { _tag: "AllPages" }
  }

  if (path === "/graph") {
    return { _tag: "Graph" }
  }

  return { _tag: "Other", path }
}

export const makeBridge = (
  registry: AtomRegistry.AtomRegistry,
  router: typeof appRouter,
): Bridge => {
  const path = () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "")
    const full = router.state.location.pathname

    return full.startsWith(base) ? full.slice(base.length) || "/" : full
  }

  return {
    assets: assetBridge(registry),
    git: {
      exec: async (args) =>
        await runGit(
          registry,
          Effect.flatMap(GitClient, (git) => git.GitRun({ args })),
        ),
      loadIgnore: async () =>
        await runGit(
          registry,
          Effect.flatMap(GitClient, (git) => git.GitLoadIgnore()),
        ),
      saveIgnore: async (text) => {
        await runGit(
          registry,
          Effect.flatMap(GitClient, (git) => git.GitSaveIgnore({ text })),
        )
      },
    },
    run: async (effect) =>
      await Effect.runPromise(
        Effect.flatMap(AtomRegistry.getResult(registry, coreRuntime), (context) =>
          Effect.provide(effect, context),
        ),
      ),
    pagesChanged: () => {
      registry.refresh(pages)
    },
    graphName: () =>
      Option.getOrNull(
        Option.map(AsyncResult.value(registry.get(openGraph)), (opened) => opened.graph),
      ),
    route: () => routeOf(path()),
    navigate: (target) => {
      switch (target._tag) {
        case "Journals": {
          return void router.navigate({ to: "/" })
        }

        case "Page": {
          return void router.navigate({
            to: "/page/$name",
            params: { name: normalizePageName(target.name) },
          })
        }

        case "AllPages": {
          return void router.navigate({ to: "/all-pages" })
        }

        case "Graph": {
          return void router.navigate({ to: "/graph" })
        }

        case "Zoom": {
          const page = registry.get(allPages).find((candidate) => candidate.id === target.pageId)

          if (page === undefined) {
            return
          }

          return void router.navigate({
            to: "/page/$name",
            params: { name: page.name },
            search: target.blockId === null ? {} : { zoom: target.blockId },
          })
        }

        case "SidebarPage": {
          registry.set(rightSidebar, {
            _tag: "Open",
            item: { _tag: "Page", name: normalizePageName(target.name) },
          })

          return
        }

        case "SidebarBlock": {
          registry.set(rightSidebar, {
            _tag: "Open",
            item: { _tag: "Block", blockId: target.blockId },
          })

          return
        }

        case "Other": {
          return
        }
      }
    },
    notify: (message) => {
      notify(registry, message)
    },
    themeMode: () => registry.get(resolvedTheme),
    showBrackets: () => registry.get(showBrackets),
    setSidebar: (side, visible) => {
      if (side === "left") {
        registry.set(leftSidebarOpen, visible)

        return
      }

      if (registry.get(rightSidebar).open !== visible) {
        registry.set(rightSidebar, { _tag: "Toggle" })
      }
    },
    sidebarOpen: (side) =>
      side === "left" ? registry.get(leftSidebarOpen) : registry.get(rightSidebar).open,
    editBlock: (blockId, caret) => {
      registry.set(editRequest, { blockId, caret: caret ?? 0 })
    },
    exitEditing: () =>
      editingBlock()?.view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    selectedBlocks: () =>
      [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].flatMap((element) =>
        element instanceof HTMLElement ? Option.toArray(blockIdOf(element.dataset["blockId"])) : [],
      ),
  }
}
