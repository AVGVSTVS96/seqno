import { logseq } from "@seqno/dom"
import { useAtomValue } from "@effect/atom-react"
import { IconSourceCode, IconSquareToggleHorizontal } from "@tabler/icons-react"
import { useCallback, useId, useState, type MouseEvent, type ReactNode } from "react"
import type { CodeSlotProps, MacroSlotProps } from "@seqno/outliner"
import { legacyReact } from "./experiments.ts"
import { local } from "./files.ts"
import type { Host } from "./host.ts"
import { injectUI } from "./inject.ts"
import { hostAtom, macroArguments } from "./runtime.ts"
import {
  chosenThemes,
  fencedRenderers,
  uiItems,
  type FencedRenderer,
  type ThemeMode,
  type UIItem,
} from "./state.ts"

const slotted = 50

export const PluginItem = ({
  host,
  item,
  inMenu,
}: {
  readonly host: Host
  readonly item: UIItem
  readonly inMenu?: boolean
}) => {
  const names = logseq(inMenu === true ? "seqno-plugin-menu-item" : "seqno-plugin-item", item)
  return (
    <div
      {...names}
      data-place={item.type}
      data-injected-ui-item={item.pid}
      ref={(element) => {
        if (element === null) return
        injectUI(
          item.pid,
          {
            key: inMenu === true ? `pl-${item.key}` : item.key,
            slot: names.id ?? "",
            path: null,
            template: item.template,
            style: {},
            attrs: {},
            reset: false,
            close: null,
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
          <PluginItem key={`${item.pid} ${item.key}`} host={host} item={item} />
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
      {...logseq("seqno-plugin-slot")}
      data-type={type}
      contentEditable={false}
      ref={(element) => {
        if (element === null || host === null) return
        const payload = {
          type: "macro_renderer_slotted",
          slot,
          payload: { name: "renderer", arguments: macroArguments(args), uuid: blockId },
        }
        const forget = { current: () => {} }
        const timer = setTimeout(() => {
          forget.current = host.slotted(slot, payload)
        }, slotted)
        return () => {
          clearTimeout(timer)
          forget.current()
        }
      }}
    />
  )
}

export const PluginThemeLink = ({ mode }: { readonly mode: ThemeMode }) => {
  const chosen = useAtomValue(chosenThemes)[mode]
  return chosen === null ? null : (
    <link rel="stylesheet" href={local(chosen.url)} data-theme-pid={chosen.pid} />
  )
}

const stop = (event: MouseEvent) => event.stopPropagation()

const FencedCode = ({
  renderer,
  code,
  children,
}: {
  readonly renderer: FencedRenderer
  readonly code: string
  readonly children: ReactNode
}) => {
  const [showCode, setShowCode] = useState(code.trim() === "")
  const mount = useCallback(
    (node: HTMLDivElement | null) => {
      const scope = legacyReact()
      if (node === null || scope === null) return
      scope.ReactDOM.render(scope.React.createElement(renderer.render, { content: code }), node)
      return () => void scope.ReactDOM.unmountComponentAtNode(node)
    },
    [renderer, code],
  )
  return (
    <div {...logseq("seqno-fenced-code", showCode)} data-active={showCode || undefined}>
      <div {...logseq("seqno-fenced-code-source")}>{children}</div>
      <div {...logseq("seqno-fenced-code-result", renderer.edit)}>
        <span {...logseq("seqno-fenced-code-actions")} onMouseDown={stop}>
          <button
            type="button"
            {...logseq("seqno-fenced-code-action")}
            aria-label="Show code"
            aria-pressed={showCode}
            onClick={(event) => {
              event.stopPropagation()
              setShowCode(!showCode)
            }}
          >
            <IconSquareToggleHorizontal size={14} />
          </button>
          <button type="button" {...logseq("seqno-fenced-code-action")} aria-label="Edit block">
            <IconSourceCode size={14} />
          </button>
        </span>
        <div ref={mount} {...(renderer.edit ? {} : { onMouseDown: stop, onClick: stop })} />
      </div>
    </div>
  )
}

export const PluginCode = ({ language, code, children }: CodeSlotProps) => {
  const renderer = useAtomValue(fencedRenderers).find((one) => one.type === language.toLowerCase())
  return renderer === undefined ? (
    children
  ) : (
    <FencedCode renderer={renderer} code={code}>
      {children}
    </FencedCode>
  )
}
