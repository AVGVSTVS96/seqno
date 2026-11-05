import { useAtomValue } from "@effect/atom-react"
import { Atom } from "effect/reactivity"
import { logseq } from "@seqno/dom"
import { readConfigString } from "@seqno/syntax"
import { appFileText, assetResolver } from "../../atoms.ts"

const relativeAsset = /\.\.\/assets\/[^\s"'()]+/g

export const customStyleHref = (
  configEdn: string,
  customCss: string,
  resolveAsset: (path: string) => string | undefined,
): string | null => {
  const style =
    readConfigString(configEdn, ":custom-css-url") ??
    customCss.replaceAll(relativeAsset, (link) => resolveAsset(link) ?? link)

  if (style.trim() === "") {
    return null
  }

  return style.startsWith("http")
    ? style
    : `data:text/css;charset=utf-8,${encodeURIComponent(style)}`
}

const customStyle = Atom.make((get) =>
  customStyleHref(
    get(appFileText("logseq/config.edn")) ?? "",
    get(appFileText("logseq/custom.css")) ?? "",
    get(assetResolver),
  ),
)

export const CustomCss = () => {
  const href = useAtomValue(customStyle)

  return href === null ? null : (
    <link
      {...logseq("seqno-custom-css")}
      rel="stylesheet"
      type="text/css"
      href={href}
      media="all"
    />
  )
}
