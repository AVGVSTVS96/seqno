import { useState } from "react"
import { mountBlockEditor } from "./editor.ts"
import type { BlockEditorOptions } from "./host.ts"

export const BlockEditor = (options: BlockEditorOptions & { readonly className?: string }) => {
  const [mount] = useState(
    () => (parent: HTMLDivElement) => mountBlockEditor(parent, options).destroy,
  )
  return <div className={options.className} ref={mount} />
}
