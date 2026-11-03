import shellCss from "./shell/shell.css?inline"
import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react"
import { Outlet, useRouter } from "@tanstack/react-router"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useContext } from "react"
import { accentStyles, logseq, names } from "@seqno/dom"
import type { PageId } from "@seqno/domain"
import {
  Accent,
  ColorMode,
  AssetActions,
  BoardSlot,
  CodeSlot,
  MacroSlot,
  DocumentMode,
  PageDialects,
  PropertySettings,
  ScrollContent,
  ShowBrackets,
} from "@seqno/outliner"
import { blockColored } from "@seqno/pdf"
import { PluginCode, PluginMacroSlot, PluginThemeLink } from "@seqno/plugins"
import { BoardEmbed } from "./pages/Whiteboards.tsx"
import { WhiteboardTour, WhiteboardWelcome } from "./shell/WhiteboardTour.tsx"
import {
  attemptedGraph,
  lastGraph,
  leftSidebarOpen,
  openGraph,
  orgPages,
  propertyConfig,
  resolvedTheme,
  rightSidebar,
  showBrackets,
} from "../atoms.ts"
import { openAnnotationBlock, openPdf, saveAssets } from "./assets.ts"
import { demoGraph, GraphNotPicked, isDemoGraph } from "../graph-locations.ts"
import { Hints } from "./hints/Hints.tsx"
import { PdfLayer } from "./PdfLayer.tsx"
import { GraphChooser, OpenFailed } from "./OpenGraphScreen.tsx"
import { PluginSettings } from "./plugins/PluginSettings.tsx"
import { PluginUpdates } from "./plugins/PluginUpdates.tsx"
import { PluginsDialog } from "./plugins/PluginsDialog.tsx"
import { BlockMenu } from "./shell/BlockMenu.tsx"
import { CustomCss } from "./shell/custom-css.tsx"
import { ExportDialog, GraphExportDialog } from "./shell/Export.tsx"
import { Header } from "./shell/Header.tsx"
import { HelpButton } from "./shell/HelpButton.tsx"
import { LeftSidebar } from "./shell/LeftSidebar.tsx"
import { Notices } from "./shell/Notices.tsx"
import { AccentColors } from "./shell/AccentColors.tsx"
import { GraphSelect } from "./shell/GraphSelect.tsx"
import { PageMenu } from "./shell/PageMenu.tsx"
import { shellListeners } from "./shell/listeners.ts"
import { RightSidebar } from "./shell/RightSidebar.tsx"
import { Settings } from "./shell/Settings.tsx"
import { GitDialogs } from "./shell/Git.tsx"
import {
  accentColor,
  documentMode,
  leftSidebarWidth,
  rightSidebarWidth,
  wideMode,
} from "./shell/state.ts"

const pluginMacros = { Slot: PluginMacroSlot }

const boards = { Board: BoardEmbed }

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

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
  const inner = logseq("seqno-theme-inner", { leftOpen, rightOpen, wide })
  const assets: AssetActions = {
    saveFiles: (files, dialect) => saveAssets(registry, files, dialect),
    openPdf: (url) => openPdf(registry, url),
    openAnnotation: (block) => openAnnotationBlock(registry, block),
  }
  return (
    <AssetActions value={assets}>
      <MacroSlot value={pluginMacros}>
        <CodeSlot value={PluginCode}>
          <BoardSlot value={boards}>
            <div {...logseq("seqno-theme-container")}>
              <div
                {...inner}
                className={names(inner.className, colored && logseq("seqno-hl-colored").className)}
              >
                <div
                  {...logseq("app")}
                  data-left-open={leftOpen}
                  data-right-open={rightOpen}
                  data-wide={wide}
                  style={{
                    "--left-sidebar-width": `${leftWidth}px`,
                    "--right-sidebar-width": `${rightWidth}vw`,
                  }}
                >
                  <div {...logseq("left-container")}>
                    <Header />
                    <div {...logseq("main-container")}>
                      <LeftSidebar graph={graph} />
                      <main {...logseq("main-content-container")}>
                        <ScrollContent className={logseq("main-content").className}>
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
                  <GraphSelect />
                  <AccentColors />
                  <ExportDialog />
                  <GraphExportDialog />
                  <WhiteboardWelcome />
                  <WhiteboardTour />
                  <Settings />
                  <GitDialogs />
                  <Notices />
                  <PluginsDialog />
                  <PluginSettings />
                  <PluginUpdates />
                  <PluginThemeLink mode={mode} />
                  <CustomCss />
                  {isDemoGraph(graph) ? <Hints /> : null}
                </div>
              </div>
            </div>
          </BoardSlot>
        </CodeSlot>
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
        <style href="seqno/accents" precedence="app">
          {accentStyles}
        </style>
        <DocumentMode value={useAtomValue(documentMode)}>
          <ShowBrackets value={useAtomValue(showBrackets)}>
            <Accent value={useAtomValue(accentColor)}>
              <ColorMode value={useAtomValue(resolvedTheme)}>
                <Screen />
              </ColorMode>
            </Accent>
          </ShowBrackets>
        </DocumentMode>
      </PageDialects>
    </PropertySettings>
  )
}

declare module "react" {
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined
  }
}
