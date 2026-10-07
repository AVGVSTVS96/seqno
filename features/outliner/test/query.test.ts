import { expect, test } from "vitest"
import { queryClauses } from "../src/Query.tsx"

const chip = (label: string) => ({ _tag: "Chip", label })

test("labels each clause the way Logseq's query builder does", () => {
  expect(queryClauses("(task TODO DOING)")).toEqual([chip("task: TODO | DOING")])
  expect(queryClauses('"dummy"')).toEqual([chip("search: dummy")])
  expect(queryClauses("(property type book)")).toEqual([chip("type: book")])
  expect(queryClauses("(between -7d today)")).toEqual([chip("between: -7d ~ today")])
  expect(queryClauses("[[Garden Plan]]")).toEqual([chip("[[Garden Plan]]")])
  expect(queryClauses("(page-tags dummy)")).toEqual([chip("#dummy")])
  expect(queryClauses('(page "garden plan")')).toEqual([chip("page: garden plan")])
  expect(queryClauses("")).toEqual([])
})

test("draws and, or and not as bracketed groups", () => {
  expect(queryClauses("(and (task NOW) (or (priority A) (priority B)))")).toEqual([
    {
      _tag: "Group",
      op: "AND",
      clauses: [
        chip("task: NOW"),
        { _tag: "Group", op: "OR", clauses: [chip("priority: A"), chip("priority: B")] },
      ],
    },
  ])
})
