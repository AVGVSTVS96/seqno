import { useAtomSet } from "@effect/atom-react"
import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { Cause, Exit } from "effect"
import { useState, type MouseEvent } from "react"
import { normalizePageName, type Page } from "@seqno/domain"
import { dispatch } from "../../atoms.ts"
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
  const editable = page.journalDay === null

  if (link) {
    return (
      <h1 id={id} className="seqno-page-title">
        <PageLink page={page} className="seqno-page-title-link" />
      </h1>
    )
  }

  const commit = async (text: string) => {
    const title = text.replaceAll(/\s+/g, " ").trim()
    if (title === "" || title === page.title) return setDraft(null)
    const showing = matchRoute({ to: "/page/$name", params: { name: page.name } }) !== false
    const renamed = await rename({ _tag: "RenamePage", pageId: page.id, title })
    if (Exit.isFailure(renamed)) {
      return setDraft({ caret: text.length, problem: problemOf(renamed.cause) })
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
        className="seqno-page-title"
        data-editable={editable}
        tabIndex={editable ? 0 : undefined}
        onClick={(event) => {
          if (editable) setDraft({ caret: caretAt(event, page.title.length), problem: null })
        }}
        onKeyDown={(event) => {
          if (editable && event.key === "Enter") {
            event.preventDefault()
            setDraft({ caret: page.title.length, problem: null })
          }
        }}
      >
        <span className="seqno-page-title-text">{page.title}</span>
      </h1>
    )
  }

  return (
    <>
      <h1 id={id} className="seqno-page-title" data-editable>
        <textarea
          aria-label="Page title"
          className="seqno-page-title-input"
          defaultValue={page.title}
          rows={1}
          autoFocus
          spellCheck={false}
          onFocus={(event) => event.currentTarget.setSelectionRange(draft.caret, draft.caret)}
          onChange={() => {
            if (draft.problem !== null) setDraft({ caret: draft.caret, problem: null })
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
            if (event.key === "Escape") {
              event.currentTarget.value = page.title
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => void commit(event.currentTarget.value)}
        />
      </h1>
      {draft.problem === null ? null : (
        <p className="seqno-page-title-problem" role="alert">
          {draft.problem}
        </p>
      )}
    </>
  )
}
