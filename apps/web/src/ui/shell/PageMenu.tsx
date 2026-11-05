import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { useMatchRoute, useNavigate, useRouter } from "@tanstack/react-router"
import { Atom } from "effect/reactivity"
import { logseq } from "@seqno/dom"
import type { Page } from "@seqno/domain"
import { hostAtom, pluginCommands, runPageCommand } from "@seqno/plugins"
import { dispatch, favorites, rightSidebar, toggleFavorite } from "../../atoms.ts"
import { placeAt } from "./BlockMenu.tsx"
import { DeletePage } from "./DeletePage.tsx"
import { exported } from "./Export.tsx"
import { gitDialog } from "./Git.tsx"
import { MenuItem, onMenuKeyDown } from "./popover.tsx"

export const pageMenu = Atom.make<{
  readonly page: Page
  readonly x: number
  readonly y: number
} | null>(null).pipe(Atom.keepAlive)

const deleting = Atom.make<Page | null>(null).pipe(Atom.keepAlive)

const isPublic = (page: Page) => page.props["public"] === "true"

export const PageMenuItems = ({ page }: { readonly page: Page }) => {
  const toggle = useAtomSet(toggleFavorite)
  const starred = useAtomValue(favorites).some((favorite) => favorite.id === page.id)
  const setDeleting = useAtomSet(deleting)
  const setExported = useAtomSet(exported)
  const setGitDialog = useAtomSet(gitDialog)
  const run = useAtomSet(dispatch)
  const router = useRouter()
  const host = useAtomValue(hostAtom)
  const updateSidebar = useAtomSet(rightSidebar)
  const onPage = useMatchRoute()({ to: "/page/$name" })

  const plugins = useAtomValue(pluginCommands).filter(
    (command) => command.type === "page-menu-item",
  )

  const copyUrl = () => {
    const { href } = router.buildLocation({ to: "/page/$name", params: { name: page.name } })
    void navigator.clipboard
      .writeText(new URL(href, window.location.origin).href)
      .catch(() => undefined)
  }

  return (
    <>
      <MenuItem
        onSelect={() => {
          toggle(page.name)
        }}
      >
        {starred ? "Unfavorite page" : "Add to Favorites"}
      </MenuItem>
      <MenuItem
        onSelect={() => {
          setGitDialog({ _tag: "History", page: page.name })
        }}
      >
        View page history
      </MenuItem>
      <MenuItem onSelect={copyUrl}>Copy page URL</MenuItem>
      {page.name === "contents" ? null : (
        <MenuItem
          onSelect={() => {
            setDeleting(page)
          }}
        >
          Delete page
        </MenuItem>
      )}
      {onPage === false ? null : (
        <MenuItem
          onSelect={() => {
            updateSidebar({ _tag: "Open", item: { _tag: "Slides", name: page.name } })
          }}
        >
          View as slides
        </MenuItem>
      )}
      <MenuItem
        onSelect={() => {
          setExported({
            name: page.title,
            target: { _tag: "Page", pageId: page.id },
            pages: [page.id],
          })
        }}
      >
        Export page
      </MenuItem>
      <MenuItem
        onSelect={() => {
          run({
            _tag: "SetProperty",
            target: { _tag: "PageTarget", pageId: page.id },
            key: "public",
            value: isPublic(page) ? "false" : "true",
          })
        }}
      >
        {isPublic(page) ? "Make it private" : "Make it public for publishing"}
      </MenuItem>
      {host === null
        ? null
        : plugins.map((command) => (
            <MenuItem
              key={`${command.pid} ${command.key}`}
              onSelect={() => {
                runPageCommand(host, command, page.name)
              }}
            >
              {command.label}
            </MenuItem>
          ))}
    </>
  )
}

const titleMenuNames = logseq("seqno-page-menu")

const TitleMenu = ({
  page,
  x,
  y,
  onClose,
}: {
  readonly page: Page
  readonly x: number
  readonly y: number
  readonly onClose: () => void
}) => (
  <div
    popover="manual"
    role="menu"
    aria-label="Page actions"
    tabIndex={-1}
    {...titleMenuNames}
    className={titleMenuNames.className}
    ref={(menu) => {
      if (menu === null) {
        return
      }

      menu.showPopover()
      placeAt(menu, x, y)
      menu.focus()

      const outside = (event: PointerEvent) => {
        if (!(event.target instanceof Node && menu.contains(event.target))) {
          menu.hidePopover()
        }
      }

      document.addEventListener("pointerdown", outside, true)

      return () => {
        document.removeEventListener("pointerdown", outside, true)
      }
    }}
    onToggle={(event) => {
      if (event.newState === "closed") {
        onClose()
      }
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.currentTarget.hidePopover()
      } else {
        onMenuKeyDown(event)
      }
    }}
  >
    <PageMenuItems page={page} />
  </div>
)

const deleteDialogId = "seqno-delete-page"

export const PageMenu = () => {
  const [request, setRequest] = useAtom(pageMenu)
  const [doomed, setDoomed] = useAtom(deleting)
  const matchRoute = useMatchRoute()
  const navigate = useNavigate()

  return (
    <>
      {request === null ? null : (
        <TitleMenu
          key={`${request.x},${request.y},${request.page.id}`}
          page={request.page}
          x={request.x}
          y={request.y}
          onClose={() => {
            setRequest(null)
          }}
        />
      )}
      {doomed === null ? null : (
        <DeletePage
          key={doomed.id}
          id={deleteDialogId}
          page={doomed}
          onClose={() => {
            setDoomed(null)
          }}
          onDeleted={() => {
            if (matchRoute({ to: "/page/$name", params: { name: doomed.name } }) !== false) {
              void navigate({ to: "/" })
            }
          }}
        />
      )}
    </>
  )
}
