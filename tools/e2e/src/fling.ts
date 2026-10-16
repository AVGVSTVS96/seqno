import type { Page } from "@playwright/test"

export interface Landing {
  readonly gaps: number
  readonly filled: boolean
  readonly moved: number
}

export const flingTo = (page: Page, stops: ReadonlyArray<number>, items: string) =>
  page.evaluate(
    async (run) => {
      const scroller = document.querySelector(".main-content-container")
      if (!(scroller instanceof HTMLElement)) throw new Error("no scroller")
      const box = scroller.getBoundingClientRect()
      const shown = (selector: string) =>
        [...scroller.querySelectorAll(selector)].filter((element) => {
          const at = element.getBoundingClientRect()
          return at.height > 0 && at.bottom > box.top && at.top < box.bottom
        })
      const landings: Array<Landing> = []
      for (const stop of run.stops) {
        const target = (scroller.scrollHeight - scroller.clientHeight) * stop
        for (let step = 0; step < 300; step++) {
          const left =
            Math.min(target, scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop
          if (Math.abs(left) <= 1) break
          scroller.scrollTop += Math.sign(left) * Math.min(3000, Math.abs(left))
          await new Promise(requestAnimationFrame)
        }
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
        const anchor = shown("[role=treeitem]").find(
          (row) => row.getBoundingClientRect().top >= box.top,
        )
        const before = anchor?.getBoundingClientRect().top ?? 0
        for (let wait = 0; wait < 30; wait++) await new Promise(requestAnimationFrame)
        const after = anchor?.isConnected === true ? anchor.getBoundingClientRect().top : -1
        landings.push({
          gaps: shown(".seqno-gap, .seqno-journals-gap").length,
          filled: shown(run.items).length > 0,
          moved: Math.round(Math.abs(after - before)),
        })
      }
      return landings
    },
    { stops, items },
  )

export const landedWell = (stops: ReadonlyArray<number>): ReadonlyArray<Landing> =>
  stops.map(() => ({ gaps: 0, filled: true, moved: 0 }))
