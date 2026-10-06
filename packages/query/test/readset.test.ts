import { Result } from "effect"
import { describe, expect, it } from "vitest"
import {
  blockChangeAffects,
  blockTouches,
  namesRead,
  pageTouches,
  parseLogseqQuery,
  readSet,
  type BlockFacets,
  type PageFacets,
  type QueryContext,
  type TaskFacets,
} from "../src/index.ts"

const ctx: QueryContext = { today: 20261006 }
const names = (name: string): ReadonlySet<string> =>
  new Set(name === "database" ? ["database", "db"] : [name])
const query = (text: string) => Result.getOrThrow(parseLogseqQuery(text))
const reads = (text: string) => new Set(Result.getOrThrow(readSet(query(text), ctx, names)))

const PAGE: PageFacets = {
  name: "projects/alpha",
  day: null,
  tags: [],
  aliases: [],
  namespaces: ["projects"],
  props: [],
}
const TODO: TaskFacets = { status: "todo", priority: null, scheduled: null, deadline: null }

const block = (content: string, over: Partial<BlockFacets> = {}): BlockFacets => ({
  id: "a",
  parent: null,
  content,
  task: null,
  refs: [],
  tags: [],
  props: [],
  created: 1,
  updated: 1,
  page: PAGE,
  ...over,
})

describe("read set: the keys a live query listens to", () => {
  it("keyed facets listen per value, including every alias of a page name", () => {
    expect(reads("(and (tag database) (task todo))")).toEqual(
      new Set([
        "exist",
        "page.alias",
        "tag:database",
        "tag:db",
        "task.status",
        "move",
        "page.name",
      ]),
    )
  })

  it("full text listens to text edits", () => {
    expect(reads('"deploy"')).toEqual(new Set(["exist", "text", "move", "page.alias", "page.name"]))
  })

  it("tree conditions listen to moves and structure", () => {
    expect(reads("(and (task todo) (not (under (task doing))))")).toEqual(
      new Set(["exist", "task.status", "tree", "move", "page.alias", "page.name"]),
    )
  })

  it("pages queries don't listen to block existence", () => {
    expect(reads("(page-tags work)")).toEqual(
      new Set(["move", "page.alias", "page.tag:work", "page.name"]),
    )
  })

  it("lists the names whose aliases must be resolved first", () => {
    expect(namesRead(query("(and [[Database]] (tag x) (page foo))"), ctx)).toEqual(
      Result.succeed(["database", "x", "foo"]),
    )
  })
})

describe("touches: the keys an edit invalidates", () => {
  const before = block("TODO plan", { task: TODO })
  const tagged = block("TODO plan #database", {
    task: TODO,
    refs: ["database"],
    tags: ["database"],
    updated: 2,
  })

  it("typing a tag touches only that tag", () => {
    expect(new Set(blockTouches(before, tagged))).toEqual(
      new Set(["text", "updated", "ref", "ref:database", "tag", "tag:database"]),
    )
  })

  it("creating a block touches existence, structure and its facets", () => {
    expect(new Set(blockTouches(null, before))).toEqual(
      new Set(["exist", "tree", "text", "created", "updated", "task.status"]),
    )
  })

  it("moving a block to another page touches structure and page", () => {
    const moved = block("TODO plan", {
      task: TODO,
      parent: "b",
      page: { ...PAGE, name: "inbox", namespaces: [] },
    })
    expect(new Set(blockTouches(before, moved))).toEqual(new Set(["tree", "move"]))
  })

  it("page facets touch page keys", () => {
    expect(new Set(pageTouches(PAGE, { ...PAGE, tags: ["work"], aliases: ["alpha"] }))).toEqual(
      new Set(["page.tag", "page.tag:work", "page.alias"]),
    )
    expect(new Set(pageTouches(null, PAGE))).toEqual(
      new Set(["page.name", "page.namespace", "page.namespace:projects"]),
    )
  })

  it("a query wakes only when its read set meets the touches", () => {
    const listening = reads("(and (tag database) (task todo))")
    const wakes = (touches: ReadonlyArray<string>) => touches.filter((k) => listening.has(k))
    expect(
      wakes(blockTouches(before, block("TODO plan more", { task: TODO, updated: 2 }))),
    ).toEqual([])
    expect(wakes(blockTouches(before, tagged))).toEqual(["tag:database"])
  })
})

describe("row check: a woken query re-runs only if the edited block's result changed", () => {
  const notUnderDoing = query("(and (task todo) (not (under (task doing))))")
  const before = block("TODO plan", { task: TODO })

  it("typing words into a matching block doesn't re-run", () => {
    expect(
      blockChangeAffects(
        notUnderDoing,
        ctx,
        names,
        before,
        block("TODO plan more", { task: TODO, updated: 2 }),
      ),
    ).toBe(false)
  })

  it("flipping the ancestor condition re-runs", () => {
    const doing = block("DOING plan", { task: { ...TODO, status: "doing" }, updated: 2 })
    expect(blockChangeAffects(notUnderDoing, ctx, names, before, doing)).toBe(true)
  })

  it("a block entering the result re-runs", () => {
    const tagged = block("TODO plan #database", {
      task: TODO,
      refs: ["database"],
      tags: ["database"],
      updated: 2,
    })
    expect(
      blockChangeAffects(query("(and (tag database) (task todo))"), ctx, names, before, tagged),
    ).toBe(true)
  })

  it("a change to a sorted value re-runs", () => {
    const later = block("TODO plan more", { task: TODO, updated: 2 })
    expect(
      blockChangeAffects(
        query("(and (task todo) (sort-by updated desc))"),
        ctx,
        names,
        before,
        later,
      ),
    ).toBe(true)
  })

  it("a query it can't evaluate re-runs instead of going stale", () => {
    const later = block("TODO plan more", { task: TODO, updated: 2 })
    expect(
      blockChangeAffects(query("(and (ref @page) (task todo))"), ctx, names, before, later),
    ).toBe(true)
  })
})
