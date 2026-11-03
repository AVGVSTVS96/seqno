import { Fragment, type ComponentType } from "react"

export interface MenuEntry {
  readonly label: string
  readonly keys?: string
  readonly icon?: ComponentType<{ readonly size: number }>
  readonly run: () => void
}

export type MenuGroup = ReadonlyArray<MenuEntry>

export type MenuRow = ReadonlyArray<MenuEntry | "divider">

const MenuRows = ({
  rows,
  onClose,
}: {
  readonly rows: ReadonlyArray<MenuRow>
  readonly onClose: () => void
}) => (
  <div className="wb-menu-rows" role="group" aria-label="Arrange">
    {rows.map((row, index) => (
      <div key={index} className="wb-menu-row">
        {row.map((entry, at) =>
          entry === "divider" ? (
            <div key={`divider-${at}`} className="wb-menu-row-divider" />
          ) : (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className="wb-button"
              aria-label={entry.label}
              data-tooltip={entry.label}
              data-tooltip-keys={entry.keys}
              onClick={() => {
                onClose()
                entry.run()
              }}
            >
              {entry.icon === undefined ? null : <entry.icon size={18} />}
            </button>
          ),
        )}
      </div>
    ))}
  </div>
)

export const ContextMenu = ({
  left,
  top,
  rows,
  groups,
  onClose,
}: {
  readonly left: number
  readonly top: number
  readonly rows: ReadonlyArray<MenuRow>
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
    {rows.length === 0 ? null : <MenuRows rows={rows} onClose={onClose} />}
    {groups
      .filter((group) => group.length > 0)
      .map((group, index) => (
        <Fragment key={group[0]?.label ?? index}>
          {index === 0 && rows.length === 0 ? null : (
            <div className="wb-menu-separator" role="separator" />
          )}
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
