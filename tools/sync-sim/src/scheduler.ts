import { Effect } from "effect"

interface Task {
  readonly at: number
  readonly seq: number
  readonly run: Effect.Effect<void>
}

const earlier = (a: Task, b: Task) => a.at < b.at || (a.at === b.at && a.seq < b.seq)

export class Scheduler {
  now = 0
  private seq = 0
  private readonly heap: Task[] = []

  at(time: number, run: Effect.Effect<void>) {
    this.push({ at: Math.max(Math.floor(time), this.now), seq: this.seq++, run })
  }

  after(delay: number, run: Effect.Effect<void>) {
    this.at(this.now + delay, run)
  }

  soon(delay: number, run: () => void) {
    this.after(delay, Effect.sync(run))
  }

  runWhile(keepGoing: () => boolean): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      while (keepGoing()) {
        const task = self.pop()
        if (task === undefined) {
          return
        }
        self.now = task.at
        yield* task.run
      }
    })
  }

  private push(task: Task) {
    const h = this.heap
    h.push(task)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      const above = h[parent]
      if (above === undefined || !earlier(task, above)) {
        break
      }
      h[i] = above
      h[parent] = task
      i = parent
    }
  }

  private pop(): Task | undefined {
    const h = this.heap
    const top = h[0]
    const last = h.pop()
    if (h.length === 0 || last === undefined) {
      return top
    }
    h[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      let m = i
      let best = last
      const left = h[l]
      const right = h[l + 1]
      if (left !== undefined && earlier(left, best)) {
        m = l
        best = left
      }
      if (right !== undefined && earlier(right, best)) {
        m = l + 1
        best = right
      }
      if (m === i) {
        return top
      }
      h[m] = last
      h[i] = best
      i = m
    }
  }
}
