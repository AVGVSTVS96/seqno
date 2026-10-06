import { useAtomSet } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { Page } from "@seqno/domain"
import { rightSidebar } from "../../atoms.ts"

export const PageLink = ({
  page,
  className,
  children,
}: {
  readonly page: Pick<Page, "name" | "title">
  readonly className: string
  readonly children?: ReactNode
}) => {
  const updateSidebar = useAtomSet(rightSidebar)
  return (
    <Link
      to="/page/$name"
      params={{ name: page.name }}
      className={className}
      onClick={(event) => {
        if (!event.shiftKey) return
        event.preventDefault()
        updateSidebar({ _tag: "Open", item: { _tag: "Page", name: page.name } })
      }}
    >
      {children ?? page.title}
    </Link>
  )
}
