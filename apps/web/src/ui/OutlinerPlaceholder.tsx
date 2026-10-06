import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { Option } from "effect"
import { normalizePageName, type BlockId, type PageId } from "@seqno/domain"
import { block, dispatch, focusedBlock, rows, type Row } from "../atoms.ts"
import { EditorPlaceholder } from "./EditorPlaceholder.tsx"

const pageLink = /\[\[([^\]]+)\]\]/g

const StaticText = ({ text }: { readonly text: string }) =>
  text.length === 0 ? (
    <span className="hint">Empty block</span>
  ) : (
    text.split(pageLink).map((part, index) =>
      index % 2 === 1 ? (
        <Link
          key={index}
          to="/page/$name"
          params={{ name: normalizePageName(part) }}
          className="page-ref"
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </Link>
      ) : (
        <span key={index}>{part}</span>
      ),
    )
  )

const BlockRow = ({ pageId, row }: { readonly pageId: PageId; readonly row: Row }) => {
  const current = useAtomValue(block({ pageId, blockId: row.blockId }))
  const focused = useAtomValue(focusedBlock)
  const focus = useAtomSet(focusedBlock)
  const run = useAtomSet(dispatch)
  const editing = Option.contains(focused, row.blockId)
  return Option.match(current, {
    onNone: () => null,
    onSome: (shown) => (
      <div className="block" style={{ paddingInlineStart: `${row.depth * 1.5}rem` }}>
        <button
          type="button"
          className="bullet"
          data-collapsed={row.collapsed}
          aria-label={row.collapsed ? "Expand" : "Collapse"}
          disabled={!row.hasChildren}
          onClick={() =>
            run({ _tag: "SetCollapsed", blockId: shown.id, collapsed: !row.collapsed })
          }
        />
        {editing ? (
          <EditorPlaceholder block={shown} />
        ) : (
          <div className="block-content" onClick={() => focus(Option.some(shown.id))}>
            <StaticText text={shown.text} />
          </div>
        )}
      </div>
    ),
  })
}

export const OutlinerPlaceholder = ({ pageId }: { readonly pageId: PageId }) => {
  const visible = useAtomValue(rows(pageId))
  const run = useAtomSet(dispatch, { mode: "promise" })
  const focus = useAtomSet(focusedBlock)
  const addFirst = () =>
    run({ _tag: "InsertBlock", pageId, parentId: null, text: "" }).then((events) =>
      events.forEach((event) => {
        if (event._tag === "BlockUpserted") {
          focus(Option.some<BlockId>(event.block.id))
        }
      }),
    )
  return (
    <div className="outliner">
      {visible.map((row) => (
        <BlockRow key={row.blockId} pageId={pageId} row={row} />
      ))}
      {visible.length === 0 ? (
        <button type="button" className="ghost" onClick={addFirst}>
          Add a block
        </button>
      ) : null}
    </div>
  )
}
