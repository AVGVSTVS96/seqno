import { assert, describe, it } from "@effect/vitest"
import { matchingGroups } from "../src/ui/shell/catalog.ts"

describe("keyboard shortcut catalog", () => {
  it("lists editing keys from the editor's own bindings, searchable by label", () => {
    assert.deepStrictEqual(
      matchingGroups("block up").map((group) => [group.title, group.shortcuts]),
      [["Editing", [{ label: "Move block up", combos: [["alt", "shift", "arrowup"]] }]]],
    )
    assert.deepStrictEqual(
      matchingGroups("redo").flatMap((group) => group.shortcuts),
      [
        {
          label: "Redo",
          combos: [
            ["mod", "shift", "z"],
            ["mod", "y"],
          ],
        },
      ],
    )
    assert.deepStrictEqual(
      matchingGroups("toggle children").flatMap((group) => group.shortcuts),
      [{ label: "Toggle children open or closed", combos: [["mod", ";"]] }],
    )
    assert.deepStrictEqual(matchingGroups("no such shortcut"), [])
  })
})
