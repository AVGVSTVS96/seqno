import { RegistryContext, scheduleTask } from "@effect/atom-react"
import { Option, Schema } from "effect"
import { AtomRegistry } from "effect/reactivity"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Published, publishedDataId } from "@seqno/export"
import { coreLayer } from "@seqno/outliner"
import { publishedCore } from "./core.ts"
import { SiteView } from "./Site.tsx"

const data = Schema.decodeUnknownOption(Schema.fromJsonString(Published))(
  document.getElementById(publishedDataId)?.textContent ?? "",
)

const container = document.getElementById("root")

if (container !== null) {
  Option.match(data, {
    onNone: () => {
      container.textContent = "This published graph could not be read."
    },
    onSome: (published) => {
      document.documentElement.dataset["theme"] = published.theme

      const registry = AtomRegistry.make({
        scheduleTask,
        defaultIdleTTL: 400,
        initialValues: [[coreLayer, publishedCore(published)]],
      })

      createRoot(container).render(
        <StrictMode>
          <RegistryContext.Provider value={registry}>
            <SiteView data={published} />
          </RegistryContext.Provider>
        </StrictMode>,
      )
    },
  })
}
