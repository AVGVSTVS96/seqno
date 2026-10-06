import { createRng, type Edit, type GraphModel } from "../../shared/fixture/src/index.ts"

const WORDS = ["note", "fix", "ship", "review", "meeting", "deploy", "release", "idea", "plan", "draft"]
const TAGS = ["database", "architecture", "vision", "queries", "strategy"]
const PAGES = ["Hidden Finance", "Index Editor", "area/Silver Projects", "architecture"]

export interface Keystroke {
  readonly edit: Edit
  readonly targeted: boolean
}

export function* typing(model: GraphModel, seed: number, targets: () => ReadonlyArray<string>): Generator<Keystroke> {
  const rng = createRng(seed)
  for (;;) {
    const pool = targets()
    const targeted = pool.length > 0 && rng.chance(0.5)
    const live = model.liveBlocks
    const block = targeted ? pool[rng.int(0, pool.length - 1)]! : live[rng.int(0, live.length - 1)]!
    const r = rng.next()
    const content = () => model.nodes.get(block)!.content
    if (r < 0.1) {
      for (let n = rng.int(1, 4); n > 0 && content().length > 0; n--) {
        yield { edit: { kind: "deleteText", block, index: content().length - 1, length: 1 }, targeted }
      }
      continue
    }
    const atStart = r < 0.15
    const snippet = atStart
      ? `${rng.pick(["TODO", "DOING", "DONE", "LATER"])} `
      : r < 0.27
        ? ` #${rng.pick(TAGS)}`
        : r < 0.33
          ? ` [[${rng.pick(PAGES)}]]`
          : r < 0.36
            ? `\nDEADLINE: <2025-07-0${rng.int(1, 9)} Tue>`
            : r < 0.39
              ? `\nrating:: ${rng.int(1, 5)}`
              : ` ${rng.pick(WORDS)}`
    for (let i = 0; i < snippet.length; i++) {
      const index = atStart ? i : content().length
      yield { edit: { kind: "insertText", block, index, text: snippet[i]! }, targeted }
    }
  }
}
