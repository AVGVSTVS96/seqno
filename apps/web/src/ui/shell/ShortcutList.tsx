import { IconChevronDown, IconSearch } from "@tabler/icons-react"
import { useState } from "react"
import { matchingGroups } from "./catalog.ts"
import { Keys } from "./Keys.tsx"

export const ShortcutList = () => {
  const [query, setQuery] = useState("")
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const groups = matchingGroups(query)
  const toggle = (title: string) => {
    const next = new Set(folded)
    if (!next.delete(title)) next.add(title)
    setFolded(next)
  }
  return (
    <div className="shortcut-list">
      <label className="shortcut-search">
        <IconSearch size={15} stroke={2} aria-hidden />
        <input
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts..."
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      {groups.length === 0 ? <p className="shortcut-empty">No shortcuts match</p> : null}
      {groups.map((group) => {
        const open = query.trim() !== "" || !folded.has(group.title)
        return (
          <section key={group.title} className="shortcut-group" aria-label={group.title}>
            <button
              type="button"
              className="shortcut-group-head"
              aria-expanded={open}
              onClick={() => toggle(group.title)}
            >
              <strong>{group.title}</strong>
              <IconChevronDown size={18} stroke={2} aria-hidden />
            </button>
            {open ? (
              <ul className="shortcut-rows">
                {group.shortcuts.map((shortcut) => (
                  <li key={shortcut.label} className="shortcut-row">
                    <span className="shortcut-label">{shortcut.label}</span>
                    <span className="shortcut-keys">
                      {shortcut.combos.map((combo) => (
                        <Keys key={combo.join(" ")} keys={combo} framed />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
