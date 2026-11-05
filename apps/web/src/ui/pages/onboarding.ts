import { Effect, Schema } from "effect"
import { Atom } from "effect/reactivity"
import type { Block, BlockDraft, PageId } from "@seqno/domain"
import { CoreClient } from "@seqno/rpc"
import { rerouted } from "@seqno/whiteboard"
import { appRuntime } from "../../atoms.ts"
import { setting } from "../shell/state.ts"

export const logseqResources = "https://raw.githubusercontent.com/logseq/logseq/0.10.9/resources"

export const onboardedWhiteboard = setting("seqno.onboardingWhiteboard", Schema.Boolean, false)

export const onboardingBoard = Atom.make<PageId | null>(null).pipe(Atom.keepAlive)

const fetchText = (url: string) =>
  Effect.tryPromise(
    async () =>
      await fetch(url).then(async (response) =>
        response.ok
          ? await response.text()
          : await Promise.reject(new Error(`${response.status} ${url}`)),
      ),
  )

const settled = (pageId: PageId, drafts: readonly BlockDraft[]): readonly BlockDraft[] =>
  rerouted(
    drafts.flatMap(({ id, text, props }): readonly Block[] =>
      id === undefined ? [] : [{ id, text, props, pageId, parentId: null, collapsed: false }],
    ),
  ).map((block) => ({ id: block.id, text: block.text, props: block.props, children: [] }))

export const populateOnboarding = appRuntime
  .fn((pageId: PageId, get) =>
    Effect.gen(function* () {
      const edn = yield* fetchText(`${logseqResources}/whiteboard/onboarding.edn`)
      const core = yield* CoreClient
      const [first, ...rest] = settled(pageId, yield* core.ReadWhiteboard({ pageId, edn }))

      if (first !== undefined) {
        yield* core.Dispatch({
          command: { _tag: "InsertBlocks", pageId, parentId: null, blocks: [first, ...rest] },
        })
      }

      get.set(onboardedWhiteboard, true)
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Failed to populate onboarding whiteboard", cause),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          get.set(onboardingBoard, null)
        }),
      ),
    ),
  )
  .pipe(Atom.keepAlive)
