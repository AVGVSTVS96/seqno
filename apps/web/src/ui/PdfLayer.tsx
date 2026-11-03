import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { useContext } from "react"
import { PdfPane, type PdfHost } from "@seqno/pdf"
import { hostAtom, pluginCommands, runHighlightItem } from "@seqno/plugins"
import { pdfFiles } from "./assets.ts"
import { useNavigateTo } from "./pages/navigation.ts"

export const PdfLayer = () => {
  const registry = useContext(RegistryContext)
  const navigate = useNavigateTo()
  const plugins = useAtomValue(hostAtom)
  const items = useAtomValue(pluginCommands).filter(
    (command) => command.type === "highlight-context-menu-item",
  )
  const host: PdfHost = {
    ...pdfFiles(registry),
    navigate,
    menuItems: items.map((command) => ({
      key: `${command.pid}:${command.key}`,
      label: command.label,
      clearSelection: command.clearSelection,
      run: (point) => {
        if (plugins !== null) runHighlightItem(plugins, command, point)
      },
    })),
  }
  return <PdfPane host={host} />
}
