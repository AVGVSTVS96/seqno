import { Match } from "effect"
import { describe, expect, it } from "vitest"
import { analyzeBlock, blockContent, parseInline } from "../src/index.ts"
import type { Body, Inline } from "../src/index.ts"

const math = (nodes: readonly Inline[]): readonly string[] =>
  nodes.map((node) =>
    Match.value(node).pipe(
      Match.tag("Math", ({ open, tex }) =>
        open === "$" || open === "\\(" ? `Inline(${tex})` : `Displayed(${tex})`,
      ),
      Match.tag("Text", ({ text }) => `Plain(${text})`),
      Match.orElse(({ _tag }) => _tag),
    ),
  )

const bodies = (text: string): readonly string[] =>
  blockContent(text).body.map((body: Body) =>
    Match.value(body).pipe(
      Match.tag("Math", ({ tex }) => `Math(${tex})`),
      Match.tag("Paragraph", ({ inline }) => `Paragraph[${math(inline).join(" ")}]`),
      Match.orElse(({ _tag }) => _tag),
    ),
  )

describe("inline math, as mldoc 1.5.7 reads it", () => {
  it.each([
    ["a $x^2$ b", ["Plain(a )", "Inline(x^2)", "Plain( b)"]],
    ["$5 and $10", ["Plain($5 and $10)"]],
    ["$5 and $10$", ["Plain($5 and )", "Inline(10)"]],
    ["a $$x$$ b", ["Plain(a )", "Displayed(x)", "Plain( b)"]],
    ["\\(a\\) and \\[b\\]", ["Inline(a)", "Plain( and )", "Displayed(b)"]],
    ["$a $b$", ["Plain($a )", "Inline(b)"]],
    ["$($", ["Inline(()"]],
    ["$x$y", ["Inline(x)", "Plain(y)"]],
    ["a$x$b", ["Plain(a)", "Inline(x)", "Plain(b)"]],
    ["$x$$", ["Inline(x)", "Plain($)"]],
    ["$$$", ["Plain($$$)"]],
    ["$ x$ $x $", ["Plain($ x$ $x $)"]],
    ["$\\$$", ["Inline(\\)", "Plain($)"]],
    ["a\\(b\\)c", ["Plain(a)", "Inline(b)", "Plain(c)"]],
  ])("%s", (source, expected) => {
    expect(math(parseInline(source))).toStrictEqual(expected)
  })

  it("leaves an escaped dollar as a plain dollar and reads math after an escaped backslash", () => {
    expect(math(parseInline("\\$5 and $x$"))).toStrictEqual([
      "Plain($)",
      "Plain(5 and )",
      "Inline(x)",
    ])
    expect(math(parseInline("a \\\\$x$"))).toStrictEqual(["Plain(a \\\\)", "Inline(x)"])
  })

  it("keeps code, page refs and tags ahead of math, and reads no math inside emphasis or link labels", () => {
    expect(math(parseInline("`$x$` $y$"))).toStrictEqual(["Code", "Plain( )", "Inline(y)"])
    expect(math(parseInline("[[$x$]] #$y$"))).toStrictEqual(["PageRef", "Plain( )", "Tag"])
    expect(math(parseInline("$[[p]]$ $#t$"))).toStrictEqual([
      "Inline([[p]])",
      "Plain( )",
      "Inline(#t)",
    ])
    expect(parseInline("**$x$**")[0]).toMatchObject({
      _tag: "Bold",
      children: [{ _tag: "Text", text: "$x$" }],
    })
    expect(parseInline("[label $x$](http://a.b)")[0]).toMatchObject({
      _tag: "Link",
      label: [{ _tag: "Text", text: "label $x$" }],
    })
  })

  it("reads math in org blocks too", () => {
    expect(math(parseInline("a $x$ \\(y\\)", 0, "org"))).toStrictEqual([
      "Plain(a )",
      "Inline(x)",
      "Plain( )",
      "Inline(y)",
    ])
  })

  it("gives each math node its source span", () => {
    expect(parseInline("see $x$", 10)).toStrictEqual([
      { _tag: "Text", text: "see ", span: { from: 10, to: 14 } },
      { _tag: "Math", open: "$", tex: "x", span: { from: 14, to: 17 } },
    ])
  })
})

describe("block math, as mldoc 1.5.7 reads it", () => {
  it.each([
    ["$$x$$", [], ["Math(x)"]],
    ["$$\nx = 1\n$$", [], ["Math(\nx = 1\n)"]],
    ["title\n$$\nx\n$$\nafter", ["Plain(title)"], ["Math(\nx\n)", "Paragraph[Plain(after)]"]],
    ["$$x$$ tail", [], ["Math(x)", "Paragraph[Plain( tail)]"]],
    ["$$x$$ $$y$$", [], ["Math(x)", "Math(y)"]],
    [
      "t\n$$a\nb$$ c\nd",
      ["Plain(t)"],
      ["Math(a\nb)", "Paragraph[Plain( c)]", "Paragraph[Plain(d)]"],
    ],
    ["\\begin{align}\na &= b\n\\end{align}", [], ["Math(\\begin{align}\na &= b\n\\end{align})"]],
    ["\\begin{Equation}\nE=mc^2\n\\end{equation}", [], ["Math(E=mc^2\n)"]],
    [
      "t\n\\begin{align*}\na\n\\END{ALIGN*}",
      ["Plain(t)"],
      ["Math(\\begin{align*}\na\n\\end{align*})"],
    ],
    [
      "t\n\\begin{pmatrix}a\\\\b\\end{pmatrix} after",
      ["Plain(t)"],
      ["Math(\\begin{pmatrix}\na\\\\b\\end{pmatrix})", "Paragraph[Plain( after)]"],
    ],
    ["t\n\\begin{align}\na", ["Plain(t)"], ["Math(\\begin{align}\na\\end{align})"]],
    ["$$\nunclosed", ["Plain($$)"], ["Paragraph[Plain(unclosed)]"]],
    ["$$x\n$$", [], ["Math(x\n)"]],
  ])("%j", (text, title, body) => {
    const content = blockContent(text)
    expect(math(content.title ?? [])).toStrictEqual(title)
    expect(bodies(text)).toStrictEqual(body)
  })

  it("keeps a marker or heading and moves the math into the body", () => {
    const todo = blockContent("TODO $$z$$")
    expect([todo.marker, todo.title, bodies("TODO $$z$$")]).toStrictEqual(["TODO", [], ["Math(z)"]])
    const heading = blockContent("# $$x$$")
    expect([heading.heading, heading.title, bodies("# $$x$$")]).toStrictEqual([1, [], ["Math(x)"]])
  })

  it("reads \\[ and \\( across the lines of a paragraph, and keeps the title to one line", () => {
    expect(bodies("t\n\\[\na\n\\]")).toStrictEqual(["Paragraph[Displayed(\na\n)]"])
    expect(bodies("t\nsee \\(a\nb\\) ok")).toStrictEqual([
      "Paragraph[Plain(see ) Inline(a\nb) Plain( ok)]",
    ])
    expect(bodies("t\na\n\n\\[x\n\ny\\]")).toStrictEqual([
      "Paragraph[Plain(a)]",
      "Paragraph[]",
      "Paragraph[Displayed(x\n\ny)]",
    ])
    expect(math(blockContent("\\[\na\n\\]").title ?? [])).toStrictEqual(["Plain(\\[)"])
  })

  it("keeps properties above math", () => {
    expect(bodies("t\nid:: 6553c0ac-5b8e-4b37-9d43-d3e3e4b7a6f1\n$$x$$")).toStrictEqual(["Math(x)"])
  })
})

describe("refs inside math", () => {
  it("are not refs, tags or macros", () => {
    const syntax = analyzeBlock("$[[p]]$ $#t$ $$ [[page]] $$ [[real]] #tag")
    expect(syntax.refs.map((ref) => (ref._tag === "BlockRef" ? ref.uuid : ref.name))).toStrictEqual(
      ["real", "tag"],
    )
    expect(analyzeBlock("t\n$$\n[[inside]]\n$$").refs).toStrictEqual([])
    expect(analyzeBlock("`$x$` [[p]]").refs.map((ref) => ref._tag)).toStrictEqual(["PageRef"])
  })
})

describe("#+BEGIN_EXPORT latex", () => {
  it("is math, and only with the language in lowercase, as Logseq matches it", () => {
    expect(bodies("#+BEGIN_EXPORT latex\n\\frac12\n#+END_EXPORT")).toStrictEqual([
      "Math(\\frac12\n)",
    ])
    expect(bodies("#+BEGIN_EXPORT LaTeX\na\n#+END_EXPORT")).toStrictEqual(["Code"])
  })
})
