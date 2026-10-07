import { assert, describe, it } from "@effect/vitest"
import { monthGrid } from "../src/DatePicker.tsx"
import { plannedDate, stampOf } from "../src/planning.ts"

describe("date picker", () => {
  it("lays a month out as six Sunday-first weeks, like classic's calendar", () => {
    const weeks = monthGrid(new Date(2026, 9, 1))
    assert.deepStrictEqual(
      [weeks.length, weeks[0]?.map((day) => day.getDate()), weeks[5]?.map((day) => day.getDate())],
      [6, [27, 28, 29, 30, 1, 2, 3], [1, 2, 3, 4, 5, 6, 7]],
    )
  })

  it("writes the stamp with an optional time and repeater", () => {
    const date = new Date(2026, 9, 8)
    assert.deepStrictEqual(
      [
        stampOf({ date, time: null, repeater: null }),
        stampOf({ date, time: "19:45", repeater: { count: 2, unit: "d" } }),
      ],
      ["2026-10-08 Thu", "2026-10-08 Thu 19:45 .+2d"],
    )
  })

  it("starts on the block's current date for that kind", () => {
    const text = "sow\nSCHEDULED: <2026-11-02 Mon>\nDEADLINE: <2026-12-24 Thu>"
    assert.deepStrictEqual(
      [plannedDate(text, "SCHEDULED")?.toDateString(), plannedDate("sow", "DEADLINE")],
      [new Date(2026, 10, 2).toDateString(), null],
    )
  })
})
