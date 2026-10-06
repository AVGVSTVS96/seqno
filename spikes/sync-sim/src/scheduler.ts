interface Task {
  readonly at: number
  readonly seq: number
  readonly run: () => void
}

/** Deterministic discrete-event queue: ties are broken by insertion order. */
export class Scheduler {
  now = 0
  private seq = 0
  private readonly heap: Task[] = []

  at(time: number, run: () => void) {
    this.push({ at: Math.max(time, this.now), seq: this.seq++, run })
  }

  after(delay: number, run: () => void) {
    this.at(this.now + delay, run)
  }

  get size() {
    return this.heap.length
  }

  step(): boolean {
    const task = this.pop()
    if (!task) return false
    this.now = task.at
    task.run()
    return true
  }

  runUntil(time: number) {
    while (this.heap.length > 0 && this.heap[0]!.at <= time) this.step()
    this.now = Math.max(this.now, time)
  }

  private less(a: Task, b: Task) {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq)
  }

  private push(task: Task) {
    const h = this.heap
    h.push(task)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(h[i]!, h[parent]!)) break
      ;[h[i], h[parent]] = [h[parent]!, h[i]!]
      i = parent
    }
  }

  private pop(): Task | undefined {
    const h = this.heap
    const top = h[0]
    const last = h.pop()
    if (h.length > 0 && last) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m]!, h[i]!]
        i = m
      }
    }
    return top
  }
}
