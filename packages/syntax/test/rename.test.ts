import { describe, expect, it } from "vitest"
import { applyEdit, renameInProperty, renameRefs } from "../src/index.ts"

const isGardenPlan = (name: string) => name.trim().toLowerCase() === "garden plan"

const isBeds = (name: string) => name === "beds"

const renamed = (text: string, title: string) =>
  renameRefs(text, isGardenPlan, title).reduce(applyEdit, text)

describe("renameRefs", () => {
  it("rewrites links, tags and bracketed tags to the new title", () => {
    expect(
      renamed(
        "See [[Garden Plan]], #[[garden plan]] and #Garden then [[Garden Plan]] again",
        "Garden Plan X",
      ),
    ).toBe("See [[Garden Plan X]], #[[Garden Plan X]] and #Garden then [[Garden Plan X]] again")
  })

  it("keeps a bare tag bare when the new title allows it, and brackets it when not", () => {
    expect(
      renameRefs("water #beds today", isBeds, "plots").reduce(applyEdit, "water #beds today"),
    ).toBe("water #plots today")
    expect(
      renameRefs("water #beds today", isBeds, "raised beds").reduce(applyEdit, "water #beds today"),
    ).toBe("water #[[raised beds]] today")
  })

  it("leaves code and other pages alone", () => {
    expect(renamed("`[[Garden Plan]]` and [[Garden Planner]]", "X")).toBe(
      "`[[Garden Plan]]` and [[Garden Planner]]",
    )
  })
})

describe("renameInProperty", () => {
  it("rewrites list items in tags and alias, and links in other values", () => {
    expect(renameInProperty("tags", "Garden Plan, compost", isGardenPlan, "Garden Plan X")).toBe(
      "Garden Plan X, compost",
    )
    expect(renameInProperty("alias", "garden plan", isGardenPlan, "Plots, 2026")).toBe(
      "[[Plots, 2026]]",
    )
    expect(renameInProperty("source", "[[Garden Plan]]", isGardenPlan, "Garden Plan X")).toBe(
      "[[Garden Plan X]]",
    )
    expect(renameInProperty("note", "Garden Plan", isGardenPlan, "Garden Plan X")).toBe(
      "Garden Plan",
    )
  })
})
