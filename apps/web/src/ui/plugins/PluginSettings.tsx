import { logseq } from "@seqno/dom"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { IconX } from "@tabler/icons-react"
import { useId } from "react"
import {
  hostAtom,
  installedPlugins,
  pluginSettings,
  running,
  sanitizeHtml,
  settingsFor,
  type Host,
  type SettingItem,
  type Settings,
} from "@seqno/plugins"

const textOf = (value: unknown) =>
  value === null || value === undefined ? "" : typeof value === "string" ? value : String(value)

const Field = ({
  item,
  value,
  labelledBy,
  onChange,
  onButton,
}: {
  readonly item: SettingItem
  readonly value: unknown
  readonly labelledBy: string
  readonly onChange: (value: unknown) => void
  readonly onButton: () => void
}) => {
  switch (item.type) {
    case "boolean":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={value === true}
          aria-labelledby={labelledBy}
          className="switch"
          onClick={() => onChange(value !== true)}
        >
          <span className="switch-thumb" />
        </button>
      )
    case "enum": {
      const picked = Array.isArray(value) ? value.map(String) : [textOf(value)]
      if (item.enumPicker === "checkbox" || item.enumPicker === "radio") {
        const many = item.enumPicker === "checkbox"
        return (
          <div
            role="group"
            aria-labelledby={labelledBy}
            {...logseq("plugin-setting-choices", many)}
          >
            {item.enumChoices.map((choice) => (
              <label key={choice} className="plugin-setting-choice">
                <input
                  {...logseq("plugin-setting-choice-input", many)}
                  type={many ? "checkbox" : "radio"}
                  name={item.key}
                  checked={picked.includes(choice)}
                  onChange={(event) =>
                    onChange(
                      many
                        ? event.target.checked
                          ? [...picked.filter((one) => one !== ""), choice]
                          : picked.filter((one) => one !== choice)
                        : choice,
                    )
                  }
                />
                {choice}
              </label>
            ))}
          </div>
        )
      }
      return (
        <select
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-select")}
          value={picked[0] ?? ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {item.enumChoices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      )
    }
    case "button":
      return (
        <button type="button" className="plugin-setting-button" onClick={onButton}>
          {item.title === "" ? item.key : item.title}
        </button>
      )
    case "object":
      return (
        <span className="plugin-setting-note">Edit this one in the plugin's settings file.</span>
      )
    case "string":
    case "number":
      return item.inputAs === "textarea" ? (
        <textarea
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-input", "textarea")}
          value={textOf(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-input", item.inputAs ?? item.type)}
          type={item.inputAs ?? (item.type === "number" ? "number" : "text")}
          value={textOf(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    default:
      return <span className="plugin-setting-note">This kind of setting isn't supported.</span>
  }
}

const Row = ({
  item,
  settings,
  pid,
  host,
}: {
  readonly item: SettingItem
  readonly settings: Settings
  readonly pid: string
  readonly host: Host | null
}) => {
  const labelId = useId()
  if (item.type === "heading") {
    return (
      <div {...logseq("plugin-setting-heading-item")}>
        <h3 className="plugin-setting-heading">{item.title}</h3>
      </div>
    )
  }
  return (
    <div {...logseq("plugin-setting", item.type)}>
      <div className="plugin-setting-label" id={labelId}>
        <code>{item.key}</code>
        {item.title === "" ? null : <strong>{item.title}</strong>}
      </div>
      {item.description === "" ? null : (
        <div
          className="plugin-setting-description"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description) }}
        />
      )}
      <Field
        item={item}
        value={settings[item.key] ?? item.default}
        labelledBy={labelId}
        onChange={(value) => host?.saveSettings(pid, { ...settings, [item.key]: value })}
        onButton={() =>
          void host?.requestModel(pid, item.buttonAction ?? "", [
            { type: "click", dataset: { key: item.key } },
          ])
        }
      />
    </div>
  )
}

const Form = ({ pid }: { readonly pid: string }) => {
  const host = useAtomValue(hostAtom)
  const settings = useAtomValue(pluginSettings(pid))
  const schema = useAtomValue(running)[pid]?.schema ?? []
  const plugin = useAtomValue(installedPlugins).find((one) => one.id === pid)
  return (
    <>
      <h2 className="plugin-settings-title">{plugin?.title ?? pid}</h2>
      {schema.length === 0 ? (
        <p className="plugins-empty">This plugin has no settings.</p>
      ) : (
        <div {...logseq("plugin-settings-inner")}>
          {schema.map((item) => (
            <Row key={item.key} item={item} settings={settings} pid={pid} host={host} />
          ))}
        </div>
      )}
    </>
  )
}

export const PluginSettings = () => {
  const [pid, setPid] = useAtom(settingsFor)
  return (
    <dialog
      aria-label="Plugin settings"
      className="dialog plugin-settings"
      ref={(dialog) => {
        if (dialog !== null && pid !== null && !dialog.open) dialog.showModal()
      }}
      onClose={() => setPid(null)}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close()
      }}
    >
      <button
        type="button"
        aria-label="Close"
        className="icon-button plugin-settings-close"
        onClick={(event) => event.currentTarget.closest("dialog")?.close()}
      >
        <IconX size={18} aria-hidden />
      </button>
      {pid === null ? null : <Form pid={pid} />}
    </dialog>
  )
}
