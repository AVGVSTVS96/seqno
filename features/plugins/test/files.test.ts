import { describe, expect, it } from "vitest"
import { elsewhereIn, local, referencesIn } from "../src/files.ts"

const root = `${location.origin}/lsp/xyhp915/logseq-journals-calendar/v0.11.1/`

describe("local", () => {
  it("moves a mirror URL onto seqno's own origin and leaves others alone", () => {
    expect(
      local(
        "https://pub-80f42b85b62c40219354a834fcf2bbfa.r2.dev/xyhp915/logseq-journals-calendar/v0.11.1/dist/index.html",
      ),
    ).toBe(`${root}dist/index.html`)
    expect(local("https://example.com/icon.png")).toBe("https://example.com/icon.png")
  })
})

describe("referencesIn", () => {
  it("finds the scripts, styles and icons an entry page loads", () => {
    const html = `<!doctype html><link rel="icon" href="./favicon.ico"/>
      <script type="module" crossorigin src="./assets/index-D8E5Vyeo.js"></script>
      <link rel="stylesheet" href=assets/index.css><script src="data:text/javascript,1"></script>`
    expect(referencesIn(`${root}dist/index.html`, html)).toEqual([
      `${root}dist/favicon.ico`,
      `${root}dist/assets/index-D8E5Vyeo.js`,
      `${root}dist/assets/index.css`,
    ])
  })

  it("follows a stylesheet's fonts and imports", () => {
    const css = `@import "./base.css"; .a { background: url(../img/dot.png?v=2) } @font-face { src: url('fonts/a.woff2') }`
    expect(referencesIn(`${root}dist/assets/index.css`, css)).toEqual([
      `${root}dist/img/dot.png`,
      `${root}dist/assets/fonts/a.woff2`,
      `${root}dist/assets/base.css`,
    ])
  })

  it("follows a module's relative imports and assets", () => {
    const js = `import{a as b}from"./chunk-1.js";const c=()=>import('./lazy-2.js');new URL("./w.wasm",import.meta.url);fetch("https://x.test/a.js")`
    expect(referencesIn(`${root}dist/assets/index.js`, js)).toEqual([
      `${root}dist/assets/chunk-1.js`,
      `${root}dist/assets/lazy-2.js`,
      `${root}dist/assets/w.wasm`,
    ])
  })

  it("reads nothing from images", () => {
    expect(referencesIn(`${root}dist/logo.png`, "url(./x.png)")).toEqual([])
  })
})

describe("elsewhereIn", () => {
  it("finds the scripts an entry page loads from another site, not its links", () => {
    const html = `<link rel="icon" href="https://example.test/icon.png">
      <script src="https://cdn.jsdelivr.net/npm/@logseq/libs"></script><script src="./index.js"></script>`
    expect(elsewhereIn(`${root}index.html`, html)).toEqual([
      "https://cdn.jsdelivr.net/npm/@logseq/libs",
    ])
  })

  it("follows a theme's font stylesheets and keeps only the WOFF2 files Chrome loads", () => {
    const css = `@import url("https://fonts.googleapis.com/css2?family=Fira+Code");
      @font-face { src: url('WOFF2/A.woff2') format('woff2'), url('WOFF/A.woff') format('woff') }`
    expect(elsewhereIn("https://cdn.jsdelivr.net/gh/adobe-fonts/source-sans/a.css", css)).toEqual([
      "https://fonts.googleapis.com/css2?family=Fira+Code",
      "https://cdn.jsdelivr.net/gh/adobe-fonts/source-sans/WOFF2/A.woff2",
    ])
  })

  it("reads a stylesheet with no .css in its address by its content type", () => {
    const css = "@font-face { src: url(https://fonts.gstatic.com/s/firacode/v22/a.woff2) }"
    expect(
      elsewhereIn(
        "https://fonts.googleapis.com/css2?family=Fira+Code",
        css,
        "text/css; charset=utf-8",
      ),
    ).toEqual(["https://fonts.gstatic.com/s/firacode/v22/a.woff2"])
  })
})
