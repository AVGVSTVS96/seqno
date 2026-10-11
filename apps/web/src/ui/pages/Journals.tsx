import { useAtomValue } from "@effect/atom-react"
import { useState } from "react"
import { segments, viewportOf, windowOf, type Viewport } from "@seqno/outliner"
import { journals } from "../../atoms.ts"
import { PageView } from "../PageView.tsx"
import { today } from "./atoms.ts"

const overscan = 1200
const edgeMargin = "600px 0px"
const unmeasured = 600

const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, offset) => from + offset)

export const Journals = () => {
  const until = useAtomValue(today)
  const days = useAtomValue(journals).filter((page) => (page.journalDay ?? 0) <= until)
  const [viewport, setViewport] = useState<Viewport>(() => ({
    top: 0,
    bottom: window.innerHeight,
  }))
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const [dayObserver] = useState(
    () =>
      new ResizeObserver((entries) => {
        const measured = entries.flatMap((entry) => {
          const id =
            entry.target instanceof HTMLElement ? entry.target.dataset["pageId"] : undefined
          const size = entry.borderBoxSize[0]?.blockSize
          return id === undefined || size === undefined ? [] : [[id, size] as const]
        })
        setHeights((previous) =>
          measured.every(([id, size]) => previous.get(id) === size)
            ? previous
            : new Map([...previous, ...measured]),
        )
      }),
  )

  const [edgeObserver] = useState(
    () =>
      new IntersectionObserver(
        (entries) => {
          const list = entries[0]?.target.parentElement ?? null
          setViewport((current) => viewportOf(list, current))
        },
        { rootMargin: edgeMargin, scrollMargin: edgeMargin },
      ),
  )

  const watchEdge = (element: HTMLDivElement | null) => {
    if (element === null) return
    edgeObserver.observe(element)
    return () => edgeObserver.unobserve(element)
  }

  const measure = (element: HTMLDivElement | null) => {
    if (element === null) return
    dayObserver.observe(element)
    return () => dayObserver.unobserve(element)
  }

  const known = [...heights.values()]
  const typical =
    known.length === 0 ? unmeasured : known.reduce((sum, height) => sum + height, 0) / known.length
  const tops = [0]
  for (const page of days) tops.push((tops.at(-1) ?? 0) + (heights.get(page.id) ?? typical))
  const [from, to] = windowOf(tops, viewport, overscan)

  return (
    <div className="seqno-journals">
      {segments(tops, range(from, to)).flatMap((part) =>
        part._tag === "Gap"
          ? [
              <div
                key={part.from === 0 ? "gap-start" : "gap-end"}
                ref={watchEdge}
                className="seqno-journals-gap"
                aria-hidden
                style={{ height: part.height }}
              />,
            ]
          : days.slice(part.from, part.to).map((page) => (
              <div key={page.id} ref={measure} data-page-id={page.id} className="seqno-journal">
                <PageView page={page} zoom={null} inJournals />
              </div>
            )),
      )}
    </div>
  )
}
