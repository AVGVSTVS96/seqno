import shellCss from "./shell/shell.css?inline"
import { useAtomMount, useAtomValue } from "@effect/atom-react"
import { Outlet, useRouter } from "@tanstack/react-router"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { lastGraph, leftSidebarOpen, openGraph, rightSidebar } from "../atoms.ts"
import { demoGraph, GraphNotPicked } from "../graph-locations.ts"
import { OpenGraphScreen } from "./OpenGraphScreen.tsx"
import { BlockMenu } from "./shell/BlockMenu.tsx"
import { Header } from "./shell/Header.tsx"
import { HelpButton } from "./shell/HelpButton.tsx"
import { LeftSidebar } from "./shell/LeftSidebar.tsx"
import { shellListeners } from "./shell/listeners.ts"
import { RightSidebar } from "./shell/RightSidebar.tsx"
import { leftSidebarWidth, rightSidebarWidth, wideMode } from "./shell/state.ts"

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error ? error.message : String(error)
}

const Layout = ({ graph, ready = true }: { readonly graph: string; readonly ready?: boolean }) => {
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
            <div className="main-content">{ready ? <Outlet /> : null}</div>
          </main>
        </div>
      </div>
      <RightSidebar />
      <HelpButton />
      <BlockMenu />
    </div>
  )
}

const pickerCancelled = (cause: Cause.Cause<unknown>) =>
  Cause.squash(cause) instanceof GraphNotPicked

const Screen = () => {
  const last = useAtomValue(lastGraph)
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
            <OpenGraphScreen problem={problemOf(failure.cause)} />
          ),
        onNone: () => <OpenGraphScreen problem={problemOf(failure.cause)} />,
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
