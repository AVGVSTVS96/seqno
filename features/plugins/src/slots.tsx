import { useAtomValue } from "@effect/atom-react"
import { useId } from "react"
import type { MacroSlotProps } from "@seqno/outliner"
import type { Host } from "./host.ts"
import { injectUI } from "./inject.ts"
import { hostAtom, macroArguments } from "./runtime.ts"
import { chosenThemes, uiItems, type ThemeMode, type UIItem } from "./state.ts"

const slotted = 50

const Item = ({ host, item }: { readonly host: Host; readonly item: UIItem }) => {
  const id = `injected-ui-item-${item.key}-${item.pid}`
  return (
    <div
      id={id}
      className={`injected-ui-item-${item.type}`}
      data-injected-ui-item={item.pid}
      ref={(element) => {
        if (element === null) return
        injectUI(
          item.pid,
          {
            key: item.key,
            slot: id,
            path: null,
            template: item.template,
            style: {},
            attrs: {},
            reset: false,
          },
          (name, event) => host.callModel(item.pid, name, event),
        )
      }}
    />
  )
}

export const PluginItems = ({ type }: { readonly type: UIItem["type"] }) => {
  const host = useAtomValue(hostAtom)
  const items = useAtomValue(uiItems).filter((item) => item.type === type)
  if (host === null || items.length === 0) return null
  return (
    <div className={`plugin-items plugin-items-${type}`}>
      {items
        .toSorted((left, right) => left.key.localeCompare(right.key))
        .map((item) => (
          <Item key={`${item.pid} ${item.key}`} host={host} item={item} />
        ))}
    </div>
  )
}

export const PluginMacroSlot = ({ args, blockId }: MacroSlotProps) => {
  const host = useAtomValue(hostAtom)
  const slot = `slot__${useId().replace(/[^a-z0-9]/gi, "")}`
  const [type = ""] = macroArguments(args)
  return (
    <span
      id={slot}
      className="lsp-hook-ui-slot"
      data-type={type}
      contentEditable={false}
      ref={(element) => {
        if (element === null || host === null) return
        const timer = setTimeout(
          () =>
            host.hook("app", "macro_renderer_slotted", {
              type: "macro_renderer_slotted",
              slot,
              payload: { name: "renderer", arguments: macroArguments(args), uuid: blockId },
            }),
          slotted,
        )
        return () => clearTimeout(timer)
      }}
    />
  )
}

export const PluginThemeLink = ({ mode }: { readonly mode: ThemeMode }) => {
  const chosen = useAtomValue(chosenThemes)[mode]
  return chosen === null ? null : (
    <link rel="stylesheet" href={chosen.url} data-theme-pid={chosen.pid} />
  )
}
