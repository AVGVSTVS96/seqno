import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from "@tanstack/react-virtual"
import { createContext, use, useRef, useState, type ReactNode, type RefObject } from "react"

interface Scroll {
  readonly element: HTMLElement
  readonly content: HTMLElement
}

const ScrollContext = createContext<Scroll | null>(null)

export const ScrollContent = ({
  className,
  children,
}: {
  readonly className?: string
  readonly children: ReactNode
}) => {
  const [scroll, setScroll] = useState<Scroll | null>(null)
  const attach = (content: HTMLDivElement | null) => {
    const element = content?.parentElement ?? null
    if (content !== null && element !== null) setScroll({ element, content })
  }
  return (
    <div ref={attach} className={className}>
      {scroll === null ? null : <ScrollContext value={scroll}>{children}</ScrollContext>}
    </div>
  )
}

export interface Placed {
  readonly index: number
  readonly gap: number
}

export interface VirtualList {
  readonly placed: ReadonlyArray<Placed>
  readonly trailing: number
  readonly element: RefObject<HTMLElement | null>
  readonly attach: (element: HTMLElement | null) => (() => void) | undefined
  readonly measure: (element: HTMLElement | null) => void
  readonly reveal: (index: number) => void
}

export interface VirtualListOptions {
  readonly id: string
  readonly windowed: boolean
  readonly count: number
  readonly estimate: (index: number) => number
  readonly key: (index: number) => string | number
  readonly overscan: number
  readonly keep?: ReadonlyArray<number>
}

interface Attached {
  readonly scroll: Scroll | null
  readonly margin: number
  readonly initial: Array<VirtualItem>
  readonly range: (range: Range) => Array<number>
}

const useTanStack = (options: VirtualListOptions & Attached) => {
  const { scroll } = options
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: scroll === null ? 0 : options.count,
    getScrollElement: () => scroll?.element ?? null,
    initialOffset: () => scroll?.element.scrollTop ?? 0,
    estimateSize: options.estimate,
    getItemKey: options.key,
    overscan: options.overscan,
    rangeExtractor: options.range,
    scrollMargin: options.margin,
    initialMeasurementsCache: options.initial,
  })
  return {
    items: virtualizer.getVirtualItems(),
    total: virtualizer.getTotalSize(),
    measure: virtualizer.measureElement,
    reveal: virtualizer.scrollToIndex,
    snapshot: virtualizer.takeSnapshot,
  }
}

const remembered = new Map<string, Array<VirtualItem>>()

const remember = (id: string, items: Array<VirtualItem>) => {
  remembered.delete(id)
  remembered.set(id, items)
  for (const old of remembered.keys()) {
    if (remembered.size <= 20) return
    remembered.delete(old)
  }
}

const withKept = (range: Range, keep: ReadonlyArray<number>) => {
  const shown = defaultRangeExtractor(range)
  const extra = keep.filter((index) => index >= 0 && index < range.count && !shown.includes(index))
  return extra.length === 0 ? shown : [...shown, ...extra].toSorted((a, b) => a - b)
}

const marginOf = (list: HTMLElement, scroller: HTMLElement) =>
  Math.round(
    list.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top -
      scroller.clientTop +
      scroller.scrollTop,
  )

const nothing = () => undefined

export const useVirtualList = (options: VirtualListOptions): VirtualList => {
  const context = use(ScrollContext)
  const scroll = options.windowed ? context : null
  const [margin, setMargin] = useState(0)
  const list = useRef<HTMLElement | null>(null)
  const keep = options.keep ?? []
  const { items, total, measure, reveal, snapshot } = useTanStack({
    ...options,
    scroll,
    margin,
    initial: remembered.get(options.id) ?? [],
    range: (range) => withKept(range, keep),
  })
  const attach = (element: HTMLElement | null) => {
    list.current = element
    if (element === null || scroll === null) return
    const place = () => setMargin(marginOf(element, scroll.element))
    place()
    const observer = new ResizeObserver(place)
    observer.observe(scroll.content)
    return () => {
      observer.disconnect()
      remember(options.id, snapshot())
    }
  }
  if (scroll === null) {
    return {
      placed: Array.from({ length: options.count }, (_, index) => ({ index, gap: 0 })),
      trailing: 0,
      element: list,
      attach,
      measure: nothing,
      reveal: nothing,
    }
  }
  return {
    placed: items.map((item, at) => ({
      index: item.index,
      gap: item.start - (items[at - 1]?.end ?? margin),
    })),
    trailing: margin + total - (items.at(-1)?.end ?? margin),
    element: list,
    attach,
    measure,
    reveal,
  }
}
