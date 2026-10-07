import shellCss from "./shell/shell.css?inline"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import { Outlet, useRouter } from "@tanstack/react-router"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { attemptedGraph, lastGraph, leftSidebarOpen, openGraph, rightSidebar } from "../atoms.ts"
import { demoGraph, GraphNotPicked } from "../graph-locations.ts"
import { OpenFailed, OpenGraphScreen } from "./OpenGraphScreen.tsx"
import { BlockMenu } from "./shell/BlockMenu.tsx"
import { ExportDialog } from "./shell/Export.tsx"
import { Header } from "./shell/Header.tsx"
import { HelpButton } from "./shell/HelpButton.tsx"
import { LeftSidebar } from "./shell/LeftSidebar.tsx"
import { shellListeners } from "./shell/listeners.ts"
import { RightSidebar } from "./shell/RightSidebar.tsx"
import { Settings } from "./shell/Settings.tsx"
import { leftSidebarWidth, rightSidebarWidth, wideMode } from "./shell/state.ts"

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const content = (ready: boolean, problem: string | null) =>
  problem !== null ? <OpenFailed problem={problem} /> : ready ? <Outlet /> : null

const Layout = ({
  graph,
  ready = true,
  problem = null,
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
  return (
    <div
      className="app"
      data-left-open={leftOpen}
      data-right-open={rightOpen}
      data-wide={wide}
      style={{
        "--left-sidebar-width": `${leftWidth}px`,
        "--right-sidebar-width": `${rightWidth}vw`,
      }}
    >
      <div className="left-container">
        <Header />
        <div className="main-container">
          <LeftSidebar graph={graph} />
          <main className="main-content-container">
            <div className="main-content">{content(ready, problem)}</div>
          </main>
        </div>
      </div>
      <RightSidebar />
      <HelpButton />
      <BlockMenu />
      <ExportDialog />
      <Settings />
    </div>
  )
}

const pickerCancelled = (cause: Cause.Cause<unknown>) =>
  Cause.squash(cause) instanceof GraphNotPicked

const Screen = () => {
  const last = useAtomValue(lastGraph)
  const attempted = useAtomValue(attemptedGraph)
  return AsyncResult.match(useAtomValue(openGraph), {
    onInitial: (initial) =>
      initial.waiting ? (
        <Layout graph={last ?? demoGraph} ready={false} />
      ) : (
        <OpenGraphScreen problem={null} />
      ),
    onFailure: (failure) =>
      Option.match(failure.previousSuccess, {
        onSome: (previous) =>
          pickerCancelled(failure.cause) ? (
            <Layout graph={previous.value.graph} />
          ) : (
            <Layout graph={attempted ?? previous.value.graph} problem={problemOf(failure.cause)} />
          ),
        onNone: () => (
          <Layout graph={attempted ?? last ?? demoGraph} problem={problemOf(failure.cause)} />
        ),
      }),
    onSuccess: (opened) => <Layout graph={opened.value.graph} />,
  })
}

export const Shell = () => (
  <>
    <style href="seqno/shell" precedence="app">
      {shellCss}
    </style>
    <Screen />
  </>
)

declare module "react" {
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined
  }
}
