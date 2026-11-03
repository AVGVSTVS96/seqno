import { assert, describe, it } from "@effect/vitest"
import { matchingGroups } from "../src/ui/shell/catalog.ts"

describe("keyboard shortcut catalog", () => {
  it("lists editing keys from the editor's own bindings, searchable by label", () => {
    assert.deepStrictEqual(
      matchingGroups("block up").map((group) => [group.title, group.shortcuts]),
      [["Editing", [{ label: "Move block up", combos: [["alt", "shift", "arrowup"]] }]]],
    )
    assert.deepStrictEqual(
      matchingGroups("redo").map((group) => [group.title, group.shortcuts]),
      [
        [
          "Basics",
          [
            {
              label: "Redo",
              combos: [
                ["mod", "shift", "z"],
                ["mod", "y"],
              ],
            },
          ],
        ],
        ["Vim mode", [{ label: "Undo or redo", combos: [["u"], ["ctrl", "r"]] }]],
      ],
    )
    assert.deepStrictEqual(
      matchingGroups("toggle children").map((group) => group.title),
      ["Editing", "Vim mode"],
    )
    assert.deepStrictEqual(matchingGroups("no such shortcut"), [])
  })
})
