import { Fragment, type ComponentType } from "react"

export interface MenuEntry {
  readonly label: string
  readonly keys?: string
  readonly icon?: ComponentType<{ readonly size: number }>
  readonly run: () => void
}

export type MenuGroup = ReadonlyArray<MenuEntry>

export const ContextMenu = ({
  left,
  top,
  groups,
  onClose,
}: {
  readonly left: number
  readonly top: number
  readonly groups: ReadonlyArray<MenuGroup>
  readonly onClose: () => void
}) => (
  <div
    className="wb-menu wb-context-menu"
    role="menu"
    aria-label="Whiteboard menu"
    style={{ left, top }}
    onPointerDown={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === "Escape") onClose()
    }}
  >
    {groups
      .filter((group) => group.length > 0)
      .map((group, index) => (
        <Fragment key={group[0]?.label ?? index}>
          {index === 0 ? null : <div className="wb-menu-separator" role="separator" />}
          {group.map((entry, at) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className="wb-menu-item"
              autoFocus={index === 0 && at === 0}
              onClick={() => {
                onClose()
                entry.run()
              }}
            >
              <span className="wb-menu-icon">
                {entry.icon === undefined ? null : <entry.icon size={16} />}
              </span>
              <span className="wb-menu-label">{entry.label}</span>
              {entry.keys === undefined ? null : <span className="wb-menu-keys">{entry.keys}</span>}
            </button>
          ))}
        </Fragment>
      ))}
  </div>
)
