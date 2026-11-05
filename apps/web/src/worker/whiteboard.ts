import { Effect } from "effect"
import { BlockId, newBlockId } from "@seqno/domain"
import type { BlockDraft, PageId } from "@seqno/domain"
import { clonedWhiteboard, readWhiteboard, whiteboardBlocks } from "@seqno/interop"
import { WhiteboardUnreadable } from "@seqno/rpc"

export const whiteboardDrafts = (pageId: PageId, edn: string) =>
  Effect.gen(function* () {
    const board = yield* Effect.mapError(
      Effect.fromResult(readWhiteboard(edn)),
      (reason) => new WhiteboardUnreadable({ reason }),
    )

    const ids = (yield* Effect.orDie(
      Effect.replicateEffect(newBlockId, board.shapes.length * 3),
    )).values()

    const fresh = () => ids.next().value ?? ""

    return whiteboardBlocks(clonedWhiteboard(board, fresh), pageId, (written) =>
      BlockId.make(written ?? fresh()),
    ).map((block): BlockDraft => ({
      id: block.id,
      text: block.text,
      props: block.props,
      children: [],
    }))
  })
