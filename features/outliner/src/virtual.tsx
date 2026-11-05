import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import type { Range, VirtualItem, Virtualizer } from "@tanstack/react-virtual"
import { createContext, use, useRef, useState } from "react"
import type { ReactNode, RefObject } from "react"
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

    if (content !== null && element !== null) {
      setScroll({ element, content })
    }
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
  readonly placed: readonly Placed[]
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
  readonly keep?: readonly number[]
}

interface Attached {
  readonly scroll: Scroll | null
  readonly margin: number | null
  readonly nested: boolean
  readonly element: RefObject<HTMLElement | null>
  readonly initial: VirtualItem[]
  readonly range: (range: Range) => number[]
}

type List = Virtualizer<HTMLElement, HTMLElement>

const scrollTo = (
  offset: number,
  { adjustments, behavior }: { adjustments?: number; behavior?: ScrollBehavior },
  list: List,
) => {
  const element = list.scrollElement

  if (element === null) {
    return
  }

  const top =
    adjustments === undefined
      ? offset
      : element.scrollTop + adjustments + (roundedAway.get(element) ?? 0)

  element.scrollTo(behavior === undefined ? { top } : { top, behavior })
  const away = top - element.scrollTop
  roundedAway.set(element, adjustments !== undefined && Math.abs(away) < 1 ? away : 0)
}

const roundedAway = new WeakMap<Element, number>()

const heightOf = (element: HTMLElement, entry?: ResizeObserverEntry) =>
  entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height

interface Owner {
  readonly list: List
  readonly element: HTMLElement
}

const owners = new WeakMap<Element, Owner>()

const holderOf = (list: HTMLElement) =>
  list.parentElement?.closest<HTMLElement>("[data-index]") ?? undefined

const placeOf = (holder: HTMLElement) => {
  const owner = holder.parentElement === null ? undefined : owners.get(holder.parentElement)
  const item = owner?.list.measurementsCache[owner.list.indexFromElement(holder)]

  return owner === undefined || item === undefined ? undefined : { ...owner, item }
}

const listTop = (element: HTMLElement, scroller: HTMLElement): number => {
  const holder = holderOf(element)
  const place = holder === undefined ? undefined : placeOf(holder)

  return holder === undefined || place === undefined
    ? fromTop(element, scroller)
    : laidOutTop(place.item, place.list, place.element, scroller) +
        fromTop(element, scroller) -
        fromTop(holder, scroller)
}

const laidOutTop = (item: VirtualItem, list: List, element: HTMLElement, scroller: HTMLElement) =>
  listTop(element, scroller) + item.start - list.options.scrollMargin

const wasAboveTheTop = (item: VirtualItem, list: List, element: HTMLElement | null) => {
  const scroller = list.scrollElement

  if (element === null || scroller === null) {
    return false
  }

  const top = laidOutTop(item, list, element, scroller)

  return list.itemSizeCache.has(item.key) ? top + item.size <= 0 : top < 0
}

const holdersAbove = new WeakMap<Element, boolean>()

const decide = (holder: HTMLElement, above: boolean) => {
  holdersAbove.set(holder, above)
  requestAnimationFrame(() => {
    holdersAbove.delete(holder)
  })

  return above
}

const holderWasAbove = (holder: HTMLElement, judge: () => boolean) =>
  holdersAbove.get(holder) ?? decide(holder, judge())

const arrived = (element: HTMLElement, scroller: HTMLElement, held: number) => {
  const holder = holderOf(element)

  if (holder !== undefined) {
    decide(holder, listTop(element, scroller) + held <= 0)
  }
}

const judgeRow = (item: VirtualItem, list: List, element: HTMLElement | null) => {
  const holder = element === null ? undefined : holderOf(element)
  const place = holder === undefined ? undefined : placeOf(holder)

  const holderAbove =
    holder !== undefined &&
    place !== undefined &&
    holderWasAbove(holder, () => wasAboveTheTop(place.item, place.list, place.element))

  return !holderAbove && wasAboveTheTop(item, list, element)
}

const judgeItem = (item: VirtualItem, list: List, element: HTMLElement | null) => {
  const holder = list.elementsCache.get(item.key)
  const judge = () => wasAboveTheTop(item, list, element)

  return holder === undefined ? judge() : holderWasAbove(holder, judge)
}

const measureMounted = (list: List) => {
  const mounted = [...list.elementsCache.values()]
    .flatMap((element) =>
      element.isConnected ? [{ element, index: list.indexFromElement(element) }] : [],
    )
    .toSorted((a, b) => a.index - b.index)

  for (const { element, index } of mounted) {
    list.resizeItem(index, heightOf(element))
  }
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
    measureElement: (element, entry) => heightOf(element, entry),
    onChange: () => {
      if (scroll !== null) {
        settle(scroll.element)
      }
    },
  })

  const [reveal] = useState(() => (index: number) => {
    const last = options.nested && index === virtualizer.options.count - 1
    virtualizer.scrollToIndex(index, last ? { align: "center" } : {})
  })

  const [locate] = useState(() => (key: string) => {
    const { count, getItemKey } = virtualizer.options
    let index = 0

    while (index < count && String(getItemKey(index)) !== key) {
      index++
    }

    return index < count ? virtualizer.getOffsetForIndex(index, "start")?.[0] : undefined
  })

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = options.nested
    ? (item, _delta, list) => judgeRow(item, list, options.element.current)
    : (item, _delta, list) => judgeItem(item, list, options.element.current)

  const [watch] = useState(() => (element: HTMLElement) => {
    owners.set(element, { list: virtualizer, element })

    const measure = () => {
      measureMounted(virtualizer)
    }

    const changes = new MutationObserver(measure)
    changes.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    })
    element.addEventListener("load", measure, true)

    return () => {
      changes.disconnect()
      element.removeEventListener("load", measure, true)
    }
  })

  return {
    items: virtualizer.getVirtualItems(),
    total: virtualizer.getTotalSize(),
    measure: virtualizer.measureElement,
    reveal,
    watch,
    snapshot: virtualizer.takeSnapshot,
    size: virtualizer.getTotalSize,
    locate,
  }
}

interface Remembered {
  readonly items: VirtualItem[]
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
        if (lists.size <= capacity) {
          return
        }

        lists.delete(old)
      }
    },
  }
}

const topLevel = memory(20)

const nestedLevel = memory(100)

const withKept = (range: Range, keep: readonly number[]) => {
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

const nothing = () => {}

const estimatedTotal = ({ count, estimate }: VirtualListOptions) => {
  let total = 0

  for (let index = 0; index < count; index++) {
    total += estimate(index)
  }

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

  const { items, total, measure, reveal, watch, snapshot, size, locate } = useTanStack({
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

    if (element === null || scroll === null) {
      return
    }

    const place = () => {
      setMargin(marginOf(element, scroll.element))
    }

    place()
    const observer = new ResizeObserver(place)
    observer.observe(scroll.content)
    const unlocate = locateOn(scroll.element, locate)
    const unwatch = watch(element)

    if (nested) {
      arrived(element, scroll.element, remembered.recall(options.id)?.height ?? 0)
    }

    return () => {
      observer.disconnect()
      unwatch()
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
