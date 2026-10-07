import { useState, useSyncExternalStore } from "react"
import { createPopupStore } from "./completion.ts"
import { DatePicker } from "./DatePicker.tsx"
import { mountBlockEditor, type BlockEditorOptions } from "./editor.ts"
import { PopupView } from "./Popup.tsx"

export const BlockEditor = (options: BlockEditorOptions & { readonly className?: string }) => {
  const [popups] = useState(createPopupStore)
  const [mount] = useState(
    () => (parent: HTMLDivElement) => mountBlockEditor(parent, options, popups).destroy,
  )
  const frame = useSyncExternalStore(popups.subscribe, popups.frame)
  const picker = useSyncExternalStore(popups.subscribe, popups.picker)
  return (
    <div className={options.className} ref={mount}>
      {frame === null ? null : <PopupView frame={frame} />}
      {picker === null ? null : <DatePicker key={picker.kind} frame={picker} />}
    </div>
  )
}
