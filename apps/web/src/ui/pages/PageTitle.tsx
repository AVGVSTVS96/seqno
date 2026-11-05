import { logseq } from "@seqno/dom"
import { useAtomSet } from "@effect/atom-react"
import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { Cause, Exit } from "effect"
import { useState } from "react"
import type { MouseEvent } from "react"
import { normalizePageName } from "@seqno/domain"
import type { Page } from "@seqno/domain"
import { assetPageName, hlsPagePrefix } from "@seqno/syntax"
import { dispatch } from "../../atoms.ts"
import { pageMenu } from "../shell/PageMenu.tsx"
import { PageLink } from "./PageLink.tsx"

interface Draft {
  readonly caret: number
  readonly problem: string | null
}

const caretAt = (event: MouseEvent<HTMLElement>, fallback: number) => {
  const position = document.caretPositionFromPoint(event.clientX, event.clientY)

  return position !== null && event.currentTarget.contains(position.offsetNode)
    ? position.offset
    : fallback
}

const problemOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)

  return typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : "The page could not be renamed."
}

export const PageTitle = ({
  page,
  id,
  link,
}: {
  readonly page: Page
  readonly id: string
  readonly link: boolean
}) => {
  const [draft, setDraft] = useState<Draft | null>(null)
  const rename = useAtomSet(dispatch, { mode: "promiseExit" })
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const openMenu = useAtomSet(pageMenu)
  const hls = page.title.startsWith(hlsPagePrefix)
  const editable = page.journalDay === null && !hls

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    openMenu({ page, x: event.clientX, y: event.clientY })
  }

  if (link) {
    return (
      <h1 id={id} {...logseq("seqno-page-title")} onContextMenu={onContextMenu}>
        <PageLink page={page} className={logseq("seqno-page-title-link").className} />
      </h1>
    )
  }

  const commit = async (text: string) => {
    const title = text.replaceAll(/\s+/gu, " ").trim()

    if (title === "" || title === page.title) {
      setDraft(null)

      return
    }

    const showing = matchRoute({ to: "/page/$name", params: { name: page.name } }) !== false
    const renamed = await rename({ _tag: "RenamePage", pageId: page.id, title })

    if (Exit.isFailure(renamed)) {
      setDraft({ caret: text.length, problem: problemOf(renamed.cause) })

      return
    }

    setDraft(null)

    if (showing) {
      await navigate({
        to: "/page/$name",
        params: { name: normalizePageName(title) },
        replace: true,
      })
    }
  }

  if (draft === null) {
    return (
      <h1
        id={id}
        {...logseq("seqno-page-title")}
        data-editable={editable}
        tabIndex={editable ? 0 : undefined}
        onContextMenu={onContextMenu}
        onClick={(event) => {
          if (editable) {
            setDraft({ caret: caretAt(event, page.title.length), problem: null })
          }
        }}
        onKeyDown={(event) => {
          if (editable && event.key === "Enter") {
            event.preventDefault()
            setDraft({ caret: page.title.length, problem: null })
          }
        }}
      >
        <span {...logseq("seqno-page-title-sizer")}>
          <span {...logseq("seqno-page-title-text", page.name)}>
            {hls ? <a className="seqno-asset">{assetPageName(page.title)}</a> : page.title}
          </span>
        </span>
      </h1>
    )
  }

  return (
    <>
      <h1 id={id} {...logseq("seqno-page-title")} data-editable>
        <span {...logseq("seqno-page-title-sizer")}>
          <span {...logseq("seqno-page-title-editor")}>
            <textarea
              aria-label="Page title"
              {...logseq("seqno-page-title-input")}
              defaultValue={page.title}
              rows={1}
              autoFocus
              spellCheck={false}
              onFocus={(event) => {
                event.currentTarget.setSelectionRange(draft.caret, draft.caret)
              }}
              onChange={() => {
                if (draft.problem !== null) {
                  setDraft({ caret: draft.caret, problem: null })
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  event.currentTarget.blur()
                }

                if (event.key === "Escape") {
                  event.preventDefault()
                  event.currentTarget.value = page.title
                  event.currentTarget.blur()
                }
              }}
              onBlur={(event) => void commit(event.currentTarget.value)}
            />
          </span>
        </span>
      </h1>
      {draft.problem === null ? null : (
        <p className="seqno-page-title-problem" role="alert">
          {draft.problem}
        </p>
      )}
    </>
  )
}
