import { describe, expect, it } from "vitest"
import { customStyleHref } from "../src/ui/shell/custom-css.tsx"

const assets = new Map([["../assets/paper.png", "blob:seqno/paper"]])
const resolve = (path: string) => assets.get(path)

describe("the graph's custom.css", () => {
  it("applies as a stylesheet with its ../assets/ links pointing at the graph's files", () => {
    expect(
      customStyleHref(
        "{:meta/version 1}",
        ".ls-block { background: url(../assets/paper.png), url(../assets/gone.png) }",
        resolve,
      ),
    ).toBe(
      `data:text/css;charset=utf-8,${encodeURIComponent(
        ".ls-block { background: url(blob:seqno/paper), url(../assets/gone.png) }",
      )}`,
    )
  })

  it("gives way to :custom-css-url in config.edn", () => {
    expect(
      customStyleHref(
        '{:custom-css-url "https://example.com/theme.css"}',
        ".ls-block { color: red }",
        resolve,
      ),
    ).toBe("https://example.com/theme.css")
  })

  it("applies nothing when the file is blank", () => {
    expect(customStyleHref("", "  \n", resolve)).toBeNull()
  })
})
