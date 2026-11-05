import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import { Effect } from "effect"
import { AsyncResult, Reactivity } from "effect/reactivity"
import { useState } from "react"
import { isWhiteboard, whiteboardProps } from "@seqno/domain"
import type { Page, PageId } from "@seqno/domain"
import { pageListKey } from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"
import { BoardPreview, BoardStyle, boardTitle, isUntitled } from "@seqno/whiteboard"
import { allPages, appRuntime, assetResolver, dispatchAll } from "../../atoms.ts"
import { PagesStyle } from "../PageView.tsx"
import { openedAt, pageStats } from "./atoms.ts"
import { onboardedWhiteboard, onboardingBoard, populateOnboarding } from "./onboarding.ts"

export const createWhiteboard = appRuntime.fn((title: string, get) =>
  Effect.gen(function* () {
    const onboard = !get(onboardedWhiteboard) && !get(allPages).some(isWhiteboard)
    const core = yield* CoreClient

    const created = yield* core.Dispatch({
      command: { _tag: "CreatePage", title, props: whiteboardProps },
    })

    const page = created.flatMap((event) => (event._tag === "PageUpserted" ? [event.page] : []))[0]

    if (onboard && page !== undefined) {
      get.set(onboardingBoard, page.id)
      get.set(populateOnboarding, page.id)
    }

    yield* Reactivity.invalidate(pageListKey)

    return title
  }),
)

export const useCreateWhiteboard = () => {
  const create = useAtomSet(createWhiteboard, { mode: "promise" })
  const navigate = useNavigate()

  const createAndOpen = async () => {
    const name = await create(crypto.randomUUID())
    await navigate({ to: "/page/$name", params: { name } })
  }

  return () => {
    void createAndOpen()
  }
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

export const ago = (millis: number, now: number) => {
  const seconds = Math.round((millis - now) / 1000)
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size)

  return unit === undefined ? "just now" : relative.format(Math.round(seconds / unit[1]), unit[0])
}

const newestFirst = (
  boards: readonly Page[],
  times: ReadonlyMap<PageId, number | null>,
): readonly Page[] =>
  boards.toSorted((left, right) => {
    const by = (times.get(right.id) ?? 0) - (times.get(left.id) ?? 0)

    return by === 0 ? right.id.localeCompare(left.id) : by
  })

const Card = ({
  page,
  edited,
  checked,
  selecting,
  onToggle,
}: {
  readonly page: Page
  readonly edited: string
  readonly checked: boolean
  readonly selecting: boolean
  readonly onToggle: () => void
}) => {
  const navigate = useNavigate()
  const resolveAsset = useAtomValue(assetResolver)
  const title = boardTitle(page)
  const open = () => void navigate({ to: "/page/$name", params: { name: page.name } })

  return (
    <div
      className="wb-card"
      role="link"
      tabIndex={0}
      aria-label={title}
      data-dim={selecting && !checked}
      onClick={() => {
        if (selecting) {
          onToggle()
        } else {
          open()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          open()
        }
      }}
    >
      <div className="wb-card-header">
        <div className="wb-card-title" data-untitled={isUntitled(page)}>
          <span>{title}</span>
          <input
            type="checkbox"
            className="wb-card-check"
            aria-label={`Select ${title}`}
            checked={checked}
            onClick={(event) => {
              event.stopPropagation()
            }}
            onChange={onToggle}
          />
        </div>
        <div className="wb-card-meta">{edited}</div>
      </div>
      <div className="wb-card-preview">
        <BoardPreview pageId={page.id} resolveAsset={resolveAsset} />
      </div>
    </div>
  )
}

export const Whiteboards = () => {
  const boards = useAtomValue(allPages).filter(isWhiteboard)
  const stats = AsyncResult.getOrElse(useAtomValue(pageStats), () => [])
  const create = useCreateWhiteboard()
  const remove = useAtomSet(dispatchAll, { mode: "promise" })
  const [checked, setChecked] = useState<ReadonlySet<PageId>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const times = new Map(stats.map((stat) => [stat.pageId, stat.updated ?? stat.created]))
  const now = useAtomValue(openedAt)
  const sorted = newestFirst(boards, times)
  const chosen = sorted.filter((page) => checked.has(page.id))

  const toggle = (id: PageId) => {
    const next = new Set(checked)

    if (!next.delete(id)) {
      next.add(id)
    }

    setChecked(next)
    setConfirming(false)
  }

  const deleteChosen = async () => {
    await remove(chosen.map((page) => ({ _tag: "DeletePage", pageId: page.id })))
    setChecked(new Set())
    setConfirming(false)
  }

  return (
    <div className="seqno-page wb-dashboard">
      <PagesStyle />
      <BoardStyle />
      <h1 className="wb-dashboard-title">
        <span>
          All whiteboards <span className="wb-dashboard-count">· {boards.length}</span>
        </span>
        {chosen.length === 0 ? null : confirming ? (
          <span className="wb-dashboard-confirm">
            <button
              type="button"
              className="wb-delete"
              onClick={() => {
                void deleteChosen()
              }}
            >
              Delete {chosen.length} {chosen.length === 1 ? "whiteboard" : "whiteboards"}
            </button>
            <button
              type="button"
              className="wb-delete"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="wb-delete"
            aria-label={`Delete ${chosen.length} selected`}
            onClick={() => {
              setConfirming(true)
            }}
          >
            <IconTrash size={16} aria-hidden />
            {chosen.length}
          </button>
        )}
      </h1>
      <div className="wb-grid" data-selecting={chosen.length > 0}>
        <button type="button" className="wb-create-card" onClick={create}>
          <IconPlus size={32} aria-hidden />
          <span className="wb-create-caption">New whiteboard</span>
        </button>
        {sorted.map((page) => {
          const at = times.get(page.id) ?? null

          return (
            <Card
              key={page.id}
              page={page}
              edited={at === null ? "" : `Edited ${ago(at, now)}`}
              checked={checked.has(page.id)}
              selecting={chosen.length > 0}
              onToggle={() => {
                toggle(page.id)
              }}
            />
          )
        })}
        {Array.from({ length: Math.max(0, 7 - sorted.length) }, (_, index) => (
          <div key={`placeholder-${index}`} className="wb-placeholder-card" aria-hidden />
        ))}
      </div>
    </div>
  )
}

export const BoardEmbed = ({ pageId }: { readonly pageId: PageId }) => {
  const resolveAsset = useAtomValue(assetResolver)

  return (
    <div className="wb-embed">
      <BoardStyle />
      <BoardPreview pageId={pageId} resolveAsset={resolveAsset} />
    </div>
  )
}
