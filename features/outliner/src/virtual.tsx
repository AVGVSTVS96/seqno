import {
  defaultRangeExtractor,
  measureElement,
  useVirtualizer,
  type Range,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual"
import { createContext, use, useRef, useState, type ReactNode, type RefObject } from "react"
import { fromTop, locateOn, settle } from "./place.ts"

interface Scroll {
  readonly element: HTMLElement
  readonly content: HTMLElement
}

const ScrollContext = createContext<Scroll | null>(null)

const NestedContext = createContext(false)

export const NestedLists = ({ children }: { readonly children: ReactNode }) => (
  <NestedContext value>{children}</NestedContext>
)

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
  readonly margin: number | null
  readonly nested: boolean
  readonly element: RefObject<HTMLElement | null>
  readonly initial: Array<VirtualItem>
  readonly range: (range: Range) => Array<number>
}

type List = Virtualizer<HTMLElement, HTMLElement>

const scrollTo = (
  offset: number,
  { adjustments, behavior }: { adjustments?: number; behavior?: ScrollBehavior },
  list: List,
) => {
  const element = list.scrollElement
  if (element === null) return
  const top = adjustments === undefined ? offset : element.scrollTop + adjustments
  element.scrollTo(behavior === undefined ? { top } : { top, behavior })
}

const wasAboveTheTop = (item: VirtualItem, list: List, element: HTMLElement | null) => {
  const scroller = list.scrollElement
  if (element === null || scroller === null) return false
  const top = fromTop(element, scroller) + item.start - list.options.scrollMargin
  return list.itemSizeCache.has(item.key) ? top + item.size <= 0 : top < 0
}

const holderOf = (list: HTMLElement | null) =>
  list?.parentElement?.closest<HTMLElement>("[data-index]") ?? list

const holdersAbove = new WeakMap<Element, boolean>()

const handledInside = new WeakMap<Element, number>()

let inObserverPass = false

const measuredNoting = (
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  list: List,
) => {
  inObserverPass = entry !== undefined
  return measureElement(element, entry, list)
}

const judgeRow = (item: VirtualItem, delta: number, list: List, element: HTMLElement | null) => {
  const holder = holderOf(element)
  const verdict = inObserverPass && holder !== null ? holdersAbove.get(holder) : undefined
  if (verdict !== undefined) return !verdict && wasAboveTheTop(item, list, element)
  if (holder !== null) handledInside.set(holder, (handledInside.get(holder) ?? 0) + delta)
  return wasAboveTheTop(item, list, element)
}

const judgeItem = (item: VirtualItem, delta: number, list: List, element: HTMLElement | null) => {
  const holder = list.elementsCache.get(item.key)
  const above = wasAboveTheTop(item, list, element)
  if (holder === undefined) return above
  const handled = handledInside.get(holder)
  handledInside.delete(holder)
  holdersAbove.set(holder, above)
  requestAnimationFrame(() => holdersAbove.delete(holder))
  return above && handled !== delta
}

const useTanStack = (options: VirtualListOptions & Attached) => {
  const { scroll, margin } = options
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: scroll === null || margin === null ? 0 : options.count,
    getScrollElement: () => scroll?.element ?? null,
    initialOffset: () => scroll?.element.scrollTop ?? 0,
    scrollToFn: scrollTo,
    estimateSize: options.estimate,
    getItemKey: options.key,
    overscan: options.overscan,
    rangeExtractor: options.range,
    scrollMargin: margin ?? 0,
    initialMeasurementsCache: options.initial,
    ...(options.nested ? { measureElement: measuredNoting } : {}),
    onChange: () => {
      if (scroll !== null) settle(scroll.element)
    },
  })
  const [reveal] = useState(() => (index: number) => {
    const last = options.nested && index === virtualizer.options.count - 1
    virtualizer.scrollToIndex(index, last ? { align: "center" } : {})
  })
  const [locate] = useState(() => (key: string) => {
    const { count, getItemKey } = virtualizer.options
    for (let index = 0; index < count; index++) {
      if (String(getItemKey(index)) === key)
        return virtualizer.getOffsetForIndex(index, "start")?.[0]
    }
    return undefined
  })
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = options.nested
    ? (item, delta, list) => judgeRow(item, delta, list, options.element.current)
    : (item, delta, list) => judgeItem(item, delta, list, options.element.current)
  return {
    items: virtualizer.getVirtualItems(),
    total: virtualizer.getTotalSize(),
    measure: virtualizer.measureElement,
    reveal,
    snapshot: virtualizer.takeSnapshot,
    size: virtualizer.getTotalSize,
    locate,
  }
}

interface Remembered {
  readonly items: Array<VirtualItem>
  readonly height: number
}

const memory = (capacity: number) => {
  const lists = new Map<string, Remembered>()
  return {
    recall: (id: string) => lists.get(id),
    remember: (id: string, list: Remembered) => {
      lists.delete(id)
      lists.set(id, list)
      for (const old of lists.keys()) {
        if (lists.size <= capacity) return
        lists.delete(old)
      }
    },
  }
}

const topLevel = memory(20)

const nestedLevel = memory(100)

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

const estimatedTotal = ({ count, estimate }: VirtualListOptions) => {
  let total = 0
  for (let index = 0; index < count; index++) total += estimate(index)
  return total
}

export const useHeldHeight = (id: string, windowed: boolean) => {
  const scroll = use(ScrollContext)
  const remembered = use(NestedContext) ? nestedLevel : topLevel
  return windowed && scroll !== null ? remembered.recall(id)?.height : undefined
}

export const useVirtualList = (options: VirtualListOptions): VirtualList => {
  const context = use(ScrollContext)
  const nested = use(NestedContext)
  const scroll = options.windowed ? context : null
  const remembered = nested ? nestedLevel : topLevel
  const [margin, setMargin] = useState<number | null>(null)
  const list = useRef<HTMLElement | null>(null)
  const keep = options.keep ?? []
  const held = remembered.recall(options.id)
  const { items, total, measure, reveal, snapshot, size, locate } = useTanStack({
    ...options,
    scroll,
    margin,
    nested,
    element: list,
    initial: held?.items ?? [],
    range: (range) => withKept(range, keep),
  })
  const attach = (element: HTMLElement | null) => {
    list.current = element
    if (element === null || scroll === null) return
    const place = () => setMargin(marginOf(element, scroll.element))
    place()
    const observer = new ResizeObserver(place)
    observer.observe(scroll.content)
    const unlocate = locateOn(scroll.element, locate)
    return () => {
      observer.disconnect()
      unlocate()
      remembered.remember(options.id, { items: snapshot(), height: size() })
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
  const start = margin ?? 0
  return {
    placed: items.map((item, at) => ({
      index: item.index,
      gap: item.start - (items[at - 1]?.end ?? start),
    })),
    trailing:
      margin === null
        ? (held?.height ?? estimatedTotal(options))
        : start + total - (items.at(-1)?.end ?? start),
    element: list,
    attach,
    measure,
    reveal,
  }
}
