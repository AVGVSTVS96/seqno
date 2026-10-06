import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { Effect, Exit } from "effect"
import type { EditorHost } from "./host.ts"

interface Trigger {
  readonly before: RegExp
  readonly openLength: number
  readonly complete: (query: string) => Effect.Effect<ReadonlyArray<Completion>>
}

const insertRef =
  (value: string, close: string) =>
  (view: EditorView, _completion: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + close.length) === close ? to + close.length : to
    view.dispatch({
      changes: { from, to: end, insert: value + close },
      selection: { anchor: from + value.length + close.length },
      userEvent: "input.complete",
    })
  }

const tagText = (title: string): string => (/\s/.test(title) ? `[[${title}]]` : title)

const triggers = (host: EditorHost): ReadonlyArray<Trigger> => [
  {
    before: /\(\([^()\n]*$/,
    openLength: 2,
    complete: (query) =>
      Effect.map(host.searchBlocks(query), (blocks) =>
        blocks.map((block) => ({
          label: block.text,
          type: "block",
          apply: insertRef(block.id, "))"),
        })),
      ),
  },
  {
    before: /\[\[[^[\]\n]*$/,
    openLength: 2,
    complete: (query) =>
      Effect.map(host.searchPages(query), (pages) =>
        pages.map((page) => ({
          label: page.title,
          type: "page",
          apply: insertRef(page.title, "]]"),
        })),
      ),
  },
  {
    before: /(?<=^|\s)#[^\s,.!?;:"'()[\]{}#]*$/,
    openLength: 1,
    complete: (query) =>
      Effect.map(host.searchPages(query), (pages) =>
        pages.map((page) => ({ label: page.title, type: "tag", apply: tagText(page.title) })),
      ),
  },
]

const run = <A>(context: CompletionContext, effect: Effect.Effect<A>): Promise<A | null> => {
  const controller = new AbortController()
  context.addEventListener("abort", () => controller.abort(), { onDocChange: true })
  return Effect.runPromiseExit(effect, { signal: controller.signal }).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : null,
  )
}

export const refCompletions = (host: EditorHost) => {
  const sources = triggers(host)
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    for (const trigger of sources) {
      const match = context.matchBefore(trigger.before)
      if (match !== null) {
        const from = match.from + trigger.openLength
        const options = await run(
          context,
          trigger.complete(context.state.sliceDoc(from, context.pos)),
        )
        return options === null ? null : { from, options, filter: false }
      }
    }
    return null
  }
  return autocompletion({ override: [source], icons: false })
}
