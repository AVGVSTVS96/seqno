import { describe, expect, it } from "vitest"
import { expressible } from "../src/corpus.ts"
import { parseDql } from "../src/syntax/dql.ts"
import { parseEdn } from "../src/syntax/edn.ts"
import { printSimple } from "../src/syntax/print.ts"
import { parseSimple } from "../src/syntax/simple.ts"

describe("every corpus query reads the same in all three syntaxes", () => {
  for (const e of expressible) {
    it(`${e.id} ${e.title}`, () => {
      const simple = parseSimple(e.simple!)
      expect(parseDql(e.dql!)).toEqual(simple)
      expect(parseEdn(e.edn!)).toEqual(simple)
    })
  }
})

describe("errors are plain messages, not crashes", () => {
  it.each([
    ["simple", () => parseSimple("(and (task todo) (page-tags x))"), /can't be mixed/],
    ["simple", () => parseSimple("(task.colour red)"), /unknown field/],
    ["dql", () => parseDql("LIST WHERE task.status IN todo"), /IN takes a list/],
    ["edn", () => parseEdn("{:where [[:bogus 1]]}"), /unknown field/],
  ])("%s", (_, run, message) => expect(run).toThrow(message))
})

describe("the printer writes back what the parser reads", () => {
  for (const e of expressible) {
    it(`${e.id}`, () => {
      const q = parseDql(e.dql!)
      expect(parseSimple(printSimple(q))).toEqual(q)
    })
  }
})
