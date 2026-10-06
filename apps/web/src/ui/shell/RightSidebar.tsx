import { RegistryContext, useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconCaretRightFilled,
  IconDots,
  IconFile,
  IconListDetails,
  IconX,
} from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useContext, useId, useState, type ReactNode } from "react"
import { normalizePageName, type BlockId } from "@seqno/domain"
import { blockAtom } from "@seqno/outliner"
import {
  allPages,
  dispatch,
  pageNamed,
  pages,
  rightSidebar,
  SidebarItem,
  sidebarItemKey,
} from "../../atoms.ts"
import { PageByName, PageView } from "../PageView.tsx"
import { IconButton } from "./IconButton.tsx"
import { closeSidebarItem, contentsItem } from "./listeners.ts"
import { Menu, MenuItem, MenuSeparator, usePopover } from "./popover.tsx"
import { Resizer } from "./Resizer.tsx"
import { rightSidebarWidth, rightWidthAt, rightWidthStep } from "./state.ts"

const PageTitle = ({ name }: { readonly name: string }) => {
  const page = useAtomValue(allPages).find((candidate) => candidate.name === name)
  return (
    <span className="sidebar-item-page">
      <IconFile size={14} aria-hidden />
      <span className="sidebar-item-text">{page?.title ?? name}</span>
    </span>
  )
}

const BlockTitle = ({ blockId }: { readonly blockId: BlockId }) => {
  const known = AsyncResult.getOrElse(useAtomValue(pages), () => [])
  const block = AsyncResult.getOrElse(useAtomValue(blockAtom(blockId)), () => null)
  const page = known.find((candidate) => candidate.id === block?.pageId)
  return <span className="sidebar-item-breadcrumb">{page?.title ?? ""}</span>
}

const ContentsTitle = () => (
  <span className="sidebar-item-contents">
    <IconListDetails size={18} aria-hidden />
    <span className="sidebar-item-text">Contents</span>
  </span>
)

const ItemTitle = ({ item }: { readonly item: SidebarItem }) =>
  SidebarItem.match(item, {
    Page: ({ name }) =>
      name === contentsItem.name ? <ContentsTitle /> : <PageTitle name={name} />,
    Block: ({ blockId }) => <BlockTitle blockId={blockId} />,
  })

const SidebarBlock = ({ blockId }: { readonly blockId: BlockId }) => {
  const known = AsyncResult.getOrElse(useAtomValue(pages), () => [])
  return AsyncResult.match(useAtomValue(blockAtom(blockId)), {
    onInitial: () => null,
    onFailure: () => <p className="sidebar-item-problem">This block could not be loaded.</p>,
    onSuccess: ({ value }) => {
      const page = known.find((candidate) => candidate.id === value.pageId)
      return page === undefined ? null : <PageView page={page} zoom={value.id} />
    },
  })
}

const ContentsBody = () => {
  const found = AsyncResult.getOrElse(useAtomValue(pageNamed(contentsItem.name)), () =>
    Option.none(),
  )
  const run = useAtomSet(dispatch, { mode: "promise" })
  return Option.match(found, {
    onSome: (page) => <PageView page={page} zoom={null} />,
    onNone: () => (
      <button
        type="button"
        className="contents-start"
        onClick={() =>
          void run({ _tag: "CreatePage", title: "Contents" }).then((events) => {
            const created = events.find((event) => event._tag === "PageUpserted")
            if (created?._tag !== "PageUpserted") return
            return run({
              _tag: "InsertBlock",
              pageId: created.page.id,
              parentId: null,
              text: "",
            })
          })
        }
      >
        <span className="contents-start-bullet" aria-hidden />
        <span className="contents-start-label">Click here to edit…</span>
      </button>
    ),
  })
}

const ItemBody = ({ item }: { readonly item: SidebarItem }) =>
  SidebarItem.match(item, {
    Page: ({ name }) =>
      name === contentsItem.name ? <ContentsBody /> : <PageByName name={name} zoom={null} />,
    Block: ({ blockId }) => <SidebarBlock blockId={blockId} />,
  })

interface CardActions {
  readonly close: () => void
  readonly closeOthers: () => void
  readonly closeAll: () => void
  readonly toggle: () => void
  readonly collapseOthers: () => void
  readonly collapseAll: () => void
  readonly expandAll: () => void
  readonly openAsPage: (() => void) | null
}

const Card = ({
  item,
  first,
  many,
  collapsed,
  actions,
}: {
  readonly item: SidebarItem
  readonly first: boolean
  readonly many: boolean
  readonly collapsed: boolean
  readonly actions: CardActions
}) => {
  const headerId = useId()
  const menu = usePopover({ placement: { align: "start", gap: -3, inset: 0 }, kind: "menu" })
  const entries: ReadonlyArray<ReadonlyArray<readonly [string, () => void]>> = [
    [
      ["Close", actions.close],
      ...(many
        ? ([
            ["Close others", actions.closeOthers],
            ["Close all", actions.closeAll],
          ] as const)
        : []),
    ],
    [
      collapsed ? ["Expand", actions.toggle] : ["Collapse", actions.toggle],
      ...(many
        ? ([
            ["Collapse others", actions.collapseOthers],
            ["Collapse all", actions.collapseAll],
            ["Expand all", actions.expandAll],
          ] as const)
        : []),
    ],
    actions.openAsPage === null ? [] : [["Open as page", actions.openAsPage]],
  ]
  const groups = entries.filter((group) => group.length > 0)
  return (
    <section className="sidebar-item" data-first={first} aria-labelledby={headerId}>
      <div className="sidebar-item-header">
        <button
          id={headerId}
          type="button"
          className="sidebar-item-toggle"
          aria-expanded={!collapsed}
          onClick={actions.toggle}
          onPointerUp={(event) => {
            if (event.button === 1) actions.close()
          }}
        >
          <span className="sidebar-item-arrow" aria-hidden>
            <IconCaretRightFilled size={16} />
          </span>
          <span className="sidebar-item-title">
            <ItemTitle item={item} />
          </span>
        </button>
        <div className="sidebar-item-actions">
          <IconButton
            label="More actions"
            className="sidebar-item-action"
            icon={<IconDots size={18} aria-hidden />}
            {...menu.trigger}
          />
          <IconButton
            label="Close"
            className="sidebar-item-action"
            icon={<IconX size={18} aria-hidden />}
            onClick={actions.close}
          />
        </div>
        <Menu handle={menu} label="Sidebar item" className="sidebar-item-menu">
          {groups.map((group, index) => (
            <Group key={group[0]?.[0] ?? index} separated={index > 0}>
              {group.map(([label, run]) => (
                <MenuItem key={label} onSelect={run}>
                  {label}
                </MenuItem>
              ))}
            </Group>
          ))}
        </Menu>
      </div>
      {collapsed ? null : (
        <div className="sidebar-item-content" role="region" aria-labelledby={headerId}>
          <ItemBody item={item} />
        </div>
      )}
    </section>
  )
}

const Group = ({
  separated,
  children,
}: {
  readonly separated: boolean
  readonly children: ReactNode
}) => (
  <>
    {separated ? <MenuSeparator /> : null}
    {children}
  </>
)

const Cards = ({ items }: { readonly items: ReadonlyArray<SidebarItem> }) => {
  const registry = useContext(RegistryContext)
  const updateSidebar = useAtomSet(rightSidebar)
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const shown = items.length === 0 ? [contentsItem] : items
  const keys = shown.map(sidebarItemKey)
  const many = shown.length > 1
  return (
    <div className="sidebar-item-list">
      {shown.map((item, index) => {
        const key = sidebarItemKey(item)
        const isCollapsed = collapsed.has(key)
        const actions: CardActions = {
          close: () =>
            items.length === 0
              ? updateSidebar({ _tag: "Toggle" })
              : closeSidebarItem(registry, item),
          closeOthers: () =>
            items.forEach((other) => {
              if (sidebarItemKey(other) !== key) updateSidebar({ _tag: "Close", item: other })
            }),
          closeAll: () => updateSidebar({ _tag: "Clear" }),
          toggle: () =>
            setCollapsed((current) =>
              current.has(key)
                ? new Set([...current].filter((other) => other !== key))
                : new Set([...current, key]),
            ),
          collapseOthers: () => setCollapsed(new Set(keys.filter((other) => other !== key))),
          collapseAll: () => setCollapsed(new Set(keys)),
          expandAll: () => setCollapsed(new Set()),
          openAsPage: SidebarItem.match(item, {
            Page:
              ({ name }) =>
              () =>
                void navigate({ to: "/page/$name", params: { name: normalizePageName(name) } }),
            Block: () => null,
          }),
        }
        return (
          <Card
            key={key}
            item={item}
            first={index === 0}
            many={many}
            collapsed={isCollapsed}
            actions={actions}
          />
        )
      })}
    </div>
  )
}

export const RightSidebar = () => {
  const [sidebar, updateSidebar] = useAtom(rightSidebar)
  const [width, setWidth] = useAtom(rightSidebarWidth)
  return (
    <aside
      className="right-sidebar"
      aria-label="Right sidebar"
      data-open={sidebar.open}
      inert={!sidebar.open}
      aria-hidden={!sidebar.open}
    >
      <Resizer
        className="right-sidebar-resizer"
        label="Resize the right sidebar"
        value={width}
        min={10}
        max={70}
        onStart={() => {
          const app = document.querySelector<HTMLElement>(".app")
          app?.setAttribute("data-resizing", "")
          const latest = { percent: width, hidden: false }
          return {
            onMove: (pointerX) => {
              const next = rightWidthAt(pointerX, window.innerWidth)
              latest.hidden = next._tag === "Hidden"
              if (next._tag === "Shown") latest.percent = next.percent
              app?.style.setProperty("--right-sidebar-width", `${latest.percent}vw`)
            },
            onEnd: () => {
              app?.removeAttribute("data-resizing")
              setWidth(latest.percent)
              if (latest.hidden) updateSidebar({ _tag: "Toggle" })
            },
          }
        }}
        onKey={(event) => {
          const by = { ArrowLeft: 16, ArrowRight: -16 }[event.key]
          if (by === undefined) return
          event.preventDefault()
          setWidth(rightWidthStep(width, by, window.innerWidth))
        }}
      />
      {sidebar.open ? (
        <div className="right-sidebar-inner">
          <div className="right-sidebar-topbar">
            <button
              type="button"
              className="sidebar-tab"
              onClick={() => updateSidebar({ _tag: "Open", item: contentsItem })}
            >
              Contents
            </button>
          </div>
          <Cards items={sidebar.items} />
        </div>
      ) : null}
    </aside>
  )
}
