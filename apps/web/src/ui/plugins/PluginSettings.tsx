import { logseq } from "@seqno/dom"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { IconX } from "@tabler/icons-react"
import { Array as Arr, Option, Schema } from "effect"
import { useId } from "react"
import {
  hostAtom,
  installedPlugins,
  pluginSettings,
  running,
  sanitizeHtml,
  settingsFor,
} from "@seqno/plugins"
import type { Host, SettingItem, Settings } from "@seqno/plugins"

const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

const decodeShown = Schema.decodeUnknownOption(Schema.Union([Scalar, Schema.Array(Scalar)]))

type Picked = string | boolean | readonly string[]

const Field = ({
  item,
  on,
  texts,
  labelledBy,
  onChange,
  onButton,
}: {
  readonly item: SettingItem
  readonly on: boolean
  readonly texts: readonly string[]
  readonly labelledBy: string
  readonly onChange: (value: Picked) => void
  readonly onButton: () => void
}) => {
  const text = texts.join(",")

  switch (item.type) {
    case "boolean": {
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelledBy}
          className="switch"
          onClick={() => {
            onChange(!on)
          }}
        >
          <span className="switch-thumb" />
        </button>
      )
    }

    case "enum": {
      const picked = texts

      if (item.enumPicker === "checkbox" || item.enumPicker === "radio") {
        const many = item.enumPicker === "checkbox"

        return (
          <fieldset aria-labelledby={labelledBy} {...logseq("plugin-setting-choices", many)}>
            {item.enumChoices.map((choice) => (
              <label key={choice} className="plugin-setting-choice">
                <input
                  {...logseq("plugin-setting-choice-input", many)}
                  type={many ? "checkbox" : "radio"}
                  name={item.key}
                  checked={picked.includes(choice)}
                  onChange={(event) => {
                    onChange(
                      many
                        ? event.target.checked
                          ? [...picked.filter((one) => one !== ""), choice]
                          : picked.filter((one) => one !== choice)
                        : choice,
                    )
                  }}
                />
                {choice}
              </label>
            ))}
          </fieldset>
        )
      }

      return (
        <select
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-select")}
          value={picked[0] ?? ""}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        >
          {item.enumChoices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      )
    }

    case "button": {
      return (
        <button type="button" className="plugin-setting-button" onClick={onButton}>
          {item.title === "" ? item.key : item.title}
        </button>
      )
    }

    case "object": {
      return (
        <span className="plugin-setting-note">
          Edit this one in the plugin&apos;s settings file.
        </span>
      )
    }

    case "string":
    case "number": {
      return item.inputAs === "textarea" ? (
        <textarea
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-input", "textarea")}
          value={text}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      ) : (
        <input
          aria-labelledby={labelledBy}
          {...logseq("plugin-setting-input", item.inputAs ?? item.type)}
          type={item.inputAs ?? (item.type === "number" ? "number" : "text")}
          value={text}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      )
    }

    default: {
      return <span className="plugin-setting-note">This kind of setting isn&apos;t supported.</span>
    }
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
  const stored = settings[item.key] ?? item.default

  const texts = Option.match(decodeShown(stored), {
    onNone: () => [],
    onSome: (shown) => Arr.ensure(shown).map(String),
  })

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
          // oxlint-disable-next-line react/no-danger -- plugin setting descriptions are HTML, cleaned by sanitizeHtml first
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description) }}
        />
      )}
      <Field
        item={item}
        on={stored === true}
        texts={texts}
        labelledBy={labelId}
        onChange={(value) => {
          host?.saveSettings(pid, { ...settings, [item.key]: value })
        }}
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
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop light dismiss; the native dialog closes on Escape and closedby has no Safari support
    <dialog
      aria-label="Plugin settings"
      className="dialog plugin-settings"
      ref={(dialog) => {
        if (dialog !== null && pid !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
      onClose={() => {
        setPid(null)
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget.close()
        }
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
