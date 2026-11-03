import { logseq } from "@seqno/dom"
import { RegistryContext, useAtom, useAtomValue } from "@effect/atom-react"
import { IconDownload, IconX } from "@tabler/icons-react"
import { Atom, type AtomRegistry } from "effect/reactivity"
import {
  checkAllUpdates,
  lastAutoCheck,
  setAutoCheck,
  updateSelected,
  updatesComing,
  updatesDownloading,
  updatesUnchecked,
  type Updated,
} from "@seqno/plugins"
import { useContext } from "react"
import { notify } from "../shell/Notices.tsx"

const updatesOpen = Atom.make(false).pipe(Atom.keepAlive)

export const openPluginUpdates = (registry: AtomRegistry.AtomRegistry) => {
  registry.set(updatesUnchecked, [])
  registry.set(updatesOpen, true)
}

export const notifyUpdated = (registry: AtomRegistry.AtomRegistry, result: Updated | null) => {
  if (result === null) return
  notify(
    registry,
    result._tag === "Updated"
      ? `Update plugin: ${result.title} - ${result.version}`
      : `[Error]<${result.pid}> ${result.reason}`,
  )
}

export const checkAll = async (registry: AtomRegistry.AtomRegistry, themes: boolean) => {
  const { failures, cancelled } = await checkAllUpdates(registry, themes)
  for (const failure of failures) notify(registry, `[Checked]<${failure.title}> ${failure.reason}`)
  if (!cancelled && registry.get(updatesComing).length > 0) openPluginUpdates(registry)
}

export const AutoCheckUpdates = () => {
  const registry = useContext(RegistryContext)
  const on = useAtomValue(lastAutoCheck) !== false
  const toggle = () => {
    setAutoCheck(registry, !on)
    notify(registry, `Auto check for updates ${on ? "OFF" : "ON"}!`)
  }
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      tabIndex={-1}
      {...logseq("menu-item")}
      data-auto-check
      onClick={toggle}
    >
      <span {...logseq("menu-item-label")}>Auto check for updates</span>
      <span className="switch" aria-hidden>
        <span className="switch-thumb" />
      </span>
    </button>
  )
}

const Updates = () => {
  const registry = useContext(RegistryContext)
  const updates = useAtomValue(updatesComing)
  const downloading = useAtomValue(updatesDownloading)
  const [unchecked, setUnchecked] = useAtom(updatesUnchecked)
  const updateAll = () =>
    void updateSelected(registry).then((done) => {
      for (const result of done) notifyUpdated(registry, result)
    })
  return (
    <>
      <h2 className="plugin-updates-title">Found {updates.length} updates</h2>
      {updates.length === 0 ? (
        <p className="plugin-updates-done">🎉 All updated!</p>
      ) : (
        <>
          <ul {...logseq("plugin-updates-list", downloading)}>
            {updates.map((update) => {
              const checked = !unchecked.includes(update.pid)
              return (
                <li key={update.pid} {...logseq("plugin-update-item", checked)}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={downloading}
                      onChange={(event) =>
                        setUnchecked(
                          event.target.checked
                            ? unchecked.filter((pid) => pid !== update.pid)
                            : [...unchecked, update.pid],
                        )
                      }
                    />
                    <strong>
                      {update.title}
                      <sup>
                        {update.version} 👉 {update.latest.version}
                      </sup>
                    </strong>
                  </label>
                  {update.failed === null ? null : (
                    <span className="plugin-problem">{update.failed}</span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="plugin-updates-actions">
            <button
              type="button"
              className="button-primary plugin-updates-all"
              disabled={downloading || unchecked.length >= updates.length}
              onClick={updateAll}
            >
              <IconDownload size={16} aria-hidden />
              {downloading ? "Downloading updates" : "Update all of selected"}
            </button>
          </div>
        </>
      )}
    </>
  )
}

export const PluginUpdates = () => {
  const [open, setOpen] = useAtom(updatesOpen)
  return (
    <dialog
      aria-label="Plugin updates"
      className={`dialog ${logseq("plugin-updates").className}`}
      ref={(dialog) => {
        if (dialog !== null && open && !dialog.open) dialog.showModal()
      }}
      onClose={() => setOpen(false)}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
    >
      <button
        type="button"
        aria-label="Close"
        className="icon-button plugin-updates-close"
        onClick={(event) => event.currentTarget.closest("dialog")?.close()}
      >
        <IconX size={18} aria-hidden />
      </button>
      {open ? <Updates /> : null}
    </dialog>
  )
}
