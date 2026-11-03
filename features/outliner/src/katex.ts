import katex from "katex"
import mhchem from "katex/dist/contrib/mhchem.min.js?url"
import css from "katex/dist/katex.min.css?inline"

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = src
    script.addEventListener("load", () => resolve(), { once: true })
    script.addEventListener("error", () => reject(new Error(`${src} didn't load`)), { once: true })
    document.head.append(script)
  })

export const loadKatex = async () => {
  window.katex = katex
  await loadScript(mhchem).catch(() => undefined)
  return { katex, css }
}
