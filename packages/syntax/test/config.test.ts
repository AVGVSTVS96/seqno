import { describe, expect, it } from "vitest"
import { readConfigFlag, writeConfigFlag } from "../src/config.ts"

const key = ":ui/show-brackets?"

describe("config flags", () => {
  it("reads a flag, skipping commented lines, and falls back when it's missing", () => {
    expect(
      readConfigFlag("{;; :ui/show-brackets? false\n :ui/show-brackets? true}", key, false),
    ).toBe(true)
    expect(readConfigFlag("{:meta/version 1}", key, true)).toBe(true)
  })

  it("rewrites the flag in place and keeps the rest of the text", () => {
    const source =
      '{:meta/version 1\n ;; brackets\n :ui/show-brackets? true\n :preferred-format "Markdown"}\n'
    expect(writeConfigFlag(source, key, false)).toBe(source.replace("? true", "? false"))
  })

  it("adds a missing flag before the map's closing brace", () => {
    expect(writeConfigFlag("{:meta/version 1}\n", key, false)).toBe(
      "{:meta/version 1\n :ui/show-brackets? false}\n",
    )
    expect(writeConfigFlag("", key, false)).toBe("{:ui/show-brackets? false}\n")
  })
})
