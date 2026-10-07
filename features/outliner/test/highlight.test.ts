import { expect, test } from "vitest"
import { highlightLines } from "../src/highlight.ts"

test("a member access dot keeps the plain text color in TypeScript and JavaScript", () => {
  for (const language of ["ts", "js"]) {
    expect(highlightLines("fruit.color", language)).toEqual([
      [
        { text: "fruit", kind: "variable" },
        { text: ".", kind: "plain" },
        { text: "color", kind: "property" },
      ],
    ])
  }
})
