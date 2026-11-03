import shellCss from "./shell/shell.css?inline"
import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react"
import { Outlet, useRouter } from "@tanstack/react-router"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useContext } from "react"
import type { PageId } from "@seqno/domain"
import {
  AssetActions,
  BoardSlot,
  MacroSlot,
  PageDialects,
  PropertySettings,
  ScrollContent,
} from "@seqno/outliner"
import { blockColored } from "@seqno/pdf"
import { PluginMacroSlot, PluginThemeLink } from "@seqno/plugins"
import { BoardEmbed } from "./pages/Whiteboards.tsx"
import {
  attemptedGraph,
  lastGraph,
  leftSidebarOpen,
  openGraph,
  orgPages,
  propertyConfig,
  resolvedTheme,
  rightSidebar,
} from "../atoms.ts"
import { openAnnotationBlock, openPdf, saveAssets } from "./assets.ts"
import { demoGraph, GraphNotPicked, isDemoGraph } from "../graph-locations.ts"
import { Hints } from "./hints/Hints.tsx"
import { PdfLayer } from "./PdfLayer.tsx"
import { GraphChooser, OpenFailed } from "./OpenGraphScreen.tsx"
import { PluginSettings } from "./plugins/PluginSettings.tsx"
import { PluginsDialog } from "./plugins/PluginsDialog.tsx"
import { BlockMenu } from "./shell/BlockMenu.tsx"
import { ExportDialog, GraphExportDialog } from "./shell/Export.tsx"
import { Header } from "./shell/Header.tsx"
import { HelpButton } from "./shell/HelpButton.tsx"
import { LeftSidebar } from "./shell/LeftSidebar.tsx"
import { Notices } from "./shell/Notices.tsx"
import { PageMenu } from "./shell/PageMenu.tsx"
import { shellListeners } from "./shell/listeners.ts"
import { RightSidebar } from "./shell/RightSidebar.tsx"
import { Settings } from "./shell/Settings.tsx"
import { leftSidebarWidth, rightSidebarWidth, wideMode } from "./shell/state.ts"

const pluginMacros = { Slot: PluginMacroSlot }

const boards = { Board: BoardEmbed }

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const themeInner = (leftOpen: boolean, rightOpen: boolean, wide: boolean) =>
  [
    "theme-inner",
    leftOpen ? "ls-left-sidebar-open" : null,
    rightOpen ? "ls-right-sidebar-open" : null,
    wide ? "ls-wide-mode" : null,
  ]
    .filter((name) => name !== null)
    .join(" ")

const content = (ready: boolean, problem: string | null) =>
  problem !== null ? <OpenFailed problem={problem} /> : ready ? <Outlet /> : null

const Layout = ({
  graph,
  ready,
  problem,
}: {
  readonly graph: string
  readonly ready?: boolean
  readonly problem?: string | null
}) => {
  useAtomMount(shellListeners(useRouter()))
  const leftOpen = useAtomValue(leftSidebarOpen)
  const leftWidth = useAtomValue(leftSidebarWidth)
  const rightWidth = useAtomValue(rightSidebarWidth)
  const rightOpen = useAtomValue(rightSidebar).open
  const wide = useAtomValue(wideMode)
  const mode = useAtomValue(resolvedTheme)
  const registry = useContext(RegistryContext)
  const colored = useAtomValue(blockColored)
  const assets: AssetActions = {
    saveFiles: (files, dialect) => saveAssets(registry, files, dialect),
    openPdf: (url) => openPdf(registry, url),
    openAnnotation: (block) => openAnnotationBlock(registry, block),
  }
  return (
    <AssetActions value={assets}>
      <MacroSlot value={pluginMacros}>
        <BoardSlot value={boards}>
          <div className="theme-container">
            <div className={themeInner(leftOpen, rightOpen, wide)}>
              <div
                id="app-container"
                className={colored ? "app seqno-hl-colored" : "app"}
                data-left-open={leftOpen}
                data-right-open={rightOpen}
                data-wide={wide}
                style={{
                  "--left-sidebar-width": `${leftWidth}px`,
                  "--right-sidebar-width": `${rightWidth}vw`,
                }}
              >
                <div id="left-container" className="left-container">
                  <Header />
                  <div id="main-container" className="main-container cp__sidebar-main-layout">
                    <LeftSidebar graph={graph} />
                    <main id="main-content-container" className="main-content-container">
                      <ScrollContent className="main-content cp__sidebar-main-content">
                        {content(ready ?? true, problem ?? null)}
                      </ScrollContent>
                    </main>
                  </div>
                </div>
                <RightSidebar />
                <PdfLayer />
                <HelpButton />
                <BlockMenu />
                <PageMenu />
                <ExportDialog />
                <GraphExportDialog />
                <Settings />
                <Notices />
                <PluginsDialog />
                <PluginSettings />
                <PluginThemeLink mode={mode} />
                {isDemoGraph(graph) ? <Hints /> : null}
              </div>
            </div>
          </div>
        </BoardSlot>
      </MacroSlot>
    </AssetActions>
  )
}

const pickerCancelled = (cause: Cause.Cause<unknown>) =>
  Cause.squash(cause) instanceof GraphNotPicked

const Screen = () => {
  const last = useAtomValue(lastGraph)
  const attempted = useAtomValue(attemptedGraph)
  return AsyncResult.match(useAtomValue(openGraph), {
    onInitial: (initial) =>
      initial.waiting ? <Layout graph={last ?? demoGraph} ready={false} /> : <GraphChooser />,
    onFailure: (failure) =>
      Option.match(failure.previousSuccess, {
        onSome: (previous) =>
          pickerCancelled(failure.cause) ? (
            <Layout graph={previous.value.graph} />
          ) : (
            <Layout graph={attempted ?? previous.value.graph} problem={problemOf(failure.cause)} />
          ),
        onNone: () =>
          pickerCancelled(failure.cause) ? (
            <GraphChooser />
          ) : (
            <Layout graph={attempted ?? last ?? demoGraph} problem={problemOf(failure.cause)} />
          ),
      }),
    onSuccess: (opened) => <Layout graph={opened.value.graph} />,
  })
}

export const Shell = () => {
  const org = useAtomValue(orgPages)
  const dialectOf = (pageId: PageId) =>
    org.some((page) => page.id === pageId) ? "org" : "markdown"
  return (
    <PropertySettings value={useAtomValue(propertyConfig)}>
      <PageDialects value={dialectOf}>
        <style href="seqno/shell" precedence="app">
          {shellCss}
        </style>
        <Screen />
      </PageDialects>
    </PropertySettings>
  )
}

declare module "react" {
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined
  }
}
