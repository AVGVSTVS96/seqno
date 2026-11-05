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

const kinds = (code: string, language: string) =>
  highlightLines(code, language).map((line) =>
    line.filter((token) => token.kind !== "").map((token) => `${token.text}:${token.kind}`),
  )

test("JavaScript tokens take CodeMirror 5's kinds: doc tags, regexps, template strings and atoms", () => {
  expect(
    kinds(
      `/** @param x */\nconst re = /a+/g\nconst t = \`hi \${name}\`\nif (true) return null`,
      "js",
    ),
  ).toEqual([
    ["/** :comment", "@param:doctag", " x */:comment"],
    ["const:keyword", "re:def", "=:operator", "/a+/g:regexp"],
    [
      "const:keyword",
      "t:def",
      "=:operator",
      "`hi :template",
      "${:interpolation",
      "name:variable",
      "}:interpolation",
      "`:template",
    ],
    ["if:keyword", "true:atom", "return:keyword", "null:atom"],
  ])
})

test("a JSDoc tag's type and parameter name take highlight.js's type and variable kinds", () => {
  expect(kinds("/** @param {Bed} bed - the bed */", "js")).toEqual([
    [
      "/** :comment",
      "@param:doctag",
      " :comment",
      "{Bed}:docType",
      " :comment",
      "bed:docVariable",
      " - the bed */:comment",
    ],
  ])
})

test("CSS selectors split into tag, class, id, pseudo-class and attribute tokens", () => {
  expect(
    kinds("#main > a.link:hover, input[type=text] { color: #fff; display: block; }", "css"),
  ).toEqual([
    [
      "#main:id",
      ">:operator",
      "a:selector",
      ".link:qualifier",
      "hover:pseudo",
      "input:selector",
      "[type=text]:selectorAttr",
      "color:cssProperty",
      "#fff:color",
      "display:cssProperty",
      "block:atom",
    ],
  ])
})

test("HTML marks its doctype, tag brackets, attributes and a mismatched closing tag", () => {
  expect(kinds('<!doctype html>\n<div class="x">hi</span>', "html")).toEqual([
    ["<!doctype html>:meta"],
    [
      "<:tagBracket",
      "div:tag",
      "class:attribute",
      "=:operator",
      '"x":string',
      ">:tagBracket",
      "</:tagBracket",
      "span:error",
      ">:tagBracket",
    ],
  ])
})

test("HTML entities are atoms, as in CodeMirror 5's XML mode", () => {
  expect(kinds("<b>a &amp; &#169;</b>", "html")).toEqual([
    [
      "<:tagBracket",
      "b:tag",
      ">:tagBracket",
      "&amp;:entity",
      "&#169;:entity",
      "</:tagBracket",
      "b:tag",
      ">:tagBracket",
    ],
  ])
})

test("Python marks decorators, builtins, self and its literals as CodeMirror 5 does", () => {
  expect(kinds("@cache\ndef f(self):\n    print(len(x), True, None)", "python")).toEqual([
    ["@cache:meta"],
    ["def:keyword", "f:def", "self:local"],
    ["print:builtin", "len:builtin", "x:variable", "True:pyLiteral", "None:pyLiteral"],
  ])
})
