import * as fc from "fast-check"
import { Match } from "effect"
import { describe, expect, it } from "vitest"
import { analyzeBlock, parseInline, plainText } from "../src/index.ts"
import type { Inline } from "../src/index.ts"

const uuid = "650e8f2a-1b2c-4d5e-8f90-123456789abc"

const showNode = (node: Inline): string => {
  const at = `@${node.span.from}-${node.span.to}`

  switch (node._tag) {
    case "Text": {
      return `Text(${node.text})${at}`
    }

    case "Code": {
      return `Code(${node.code})${at}`
    }

    case "Math": {
      return `Math(${node.open}|${node.tex})${at}`
    }

    case "PageRef": {
      return `PageRef(${node.name}${node.brackets ? "" : ", bare"})${at}`
    }

    case "Tag": {
      return `Tag(${node.name})${at}`
    }

    case "BlockRef": {
      return `BlockRef(${node.uuid})${at}`
    }

    case "Macro": {
      return `Macro(${node.name}|${node.args})${at}`
    }

    case "Priority": {
      return `Priority(${node.priority})${at}`
    }

    case "Bold":
    case "Italic":
    case "Strike":
    case "Underline":
    case "Highlight": {
      return `${node._tag}[${show(node.children).join(" ")}]${at}`
    }

    case "Link": {
      const target = Match.valueTags(node.target, {
        Url: ({ url }) => url,
        Page: ({ name }) => name,
        Block: ({ uuid: id }) => id,
      })

      return `Link(${node.target._tag}:${target})[${show(node.label).join(" ")}]${at}`
    }

    case "Image": {
      return `Image(${node.alt}|${node.url})${at}`
    }
  }
}

const show = (nodes: readonly Inline[]): readonly string[] => nodes.map(showNode)

const nodeRefs = (node: Inline): readonly string[] => {
  switch (node._tag) {
    case "PageRef": {
      return [`PageRef:${node.name}`]
    }

    case "Tag": {
      return [`Tag:${node.name}`]
    }

    case "BlockRef": {
      return [`BlockRef:${node.uuid}`]
    }

    case "Macro": {
      return node.name === "query" ? [] : refsOf(parseInline(node.args))
    }

    case "Bold":
    case "Italic":
    case "Strike":
    case "Underline":
    case "Highlight": {
      return refsOf(node.children)
    }

    case "Link": {
      return [
        ...refsOf(node.label),
        ...Match.valueTags(node.target, {
          Page: ({ name }) => [`PageRef:${name}`],
          Block: ({ uuid: id }) => [`BlockRef:${id}`],
          Url: () => [],
        }),
      ]
    }

    case "Text":
    case "Code":
    case "Math":
    case "Priority":
    case "Image": {
      return []
    }
  }
}

const refsOf = (nodes: readonly Inline[]): readonly string[] => nodes.flatMap(nodeRefs)

describe(parseInline, () => {
  it("reads refs, tags, block refs and macros with their source spans", () => {
    expect(
      show(parseInline(`see [[a [[b]] c]], #tag, #[[multi word]] and ((${uuid})) {{embed [[p]]}}`)),
    ).toStrictEqual([
      "Text(see )@0-4",
      "PageRef(a [[b]] c)@4-17",
      "Text(, )@17-19",
      "Tag(tag)@19-23",
      "Text(, )@23-25",
      "Tag(multi word)@25-40",
      "Text( and )@40-45",
      `BlockRef(${uuid})@45-85`,
      "Text( )@85-86",
      "Macro(embed|[[p]])@86-101",
    ])
  })

  it("reads ***both*** as bold inside italic, as Logseq does", () => {
    expect(show(parseInline("a ***both*** b"))).toStrictEqual([
      "Text(a )@0-2",
      "Italic[Bold[Text(both)@5-9]@3-11]@2-12",
      "Text( b)@12-14",
    ])
  })

  it("reads emphasis, highlight, strike and inline code, nesting refs inside", () => {
    expect(
      show(parseInline("**Bold [[x]]**, *italic*, ==mark==, ~~gone~~ and `[[not a ref]]`")),
    ).toStrictEqual([
      "Bold[Text(Bold )@2-7 PageRef(x)@7-12]@0-14",
      "Text(, )@14-16",
      "Italic[Text(italic)@17-23]@16-24",
      "Text(, )@24-26",
      "Highlight[Text(mark)@28-32]@26-34",
      "Text(, )@34-36",
      "Strike[Text(gone)@38-42]@36-44",
      "Text( and )@44-49",
      "Code([[not a ref]])@49-64",
    ])
  })

  it("reads links, page links, images, bare urls and priorities", () => {
    expect(
      show(
        parseInline(
          "[#A] [the docs](https://docs.logseq.com), [see]([[Garden Plan]]), ![sketch](../assets/a.svg) https://example.com/x.",
        ),
      ),
    ).toStrictEqual([
      "Priority(A)@0-4",
      "Text( )@4-5",
      "Link(Url:https://docs.logseq.com)[Text(the docs)@6-14]@5-40",
      "Text(, )@40-42",
      "Link(Page:Garden Plan)[Text(see)@43-46]@42-64",
      "Text(, )@64-66",
      "Image(sketch|../assets/a.svg)@66-92",
      "Text( )@92-93",
      "Link(Url:https://example.com/x)[Text(https://example.com/x)@93-114]@93-114",
      "Text(.)@114-115",
    ])
  })

  it("reads classic's size suffix on an image, as part of the image", () => {
    const [sized, after] = parseInline("![s](a.png){:height 240, :width 480} x")
    expect(sized).toStrictEqual({
      _tag: "Image",
      alt: "s",
      url: "a.png",
      width: 480,
      size: { from: 11, to: 36 },
      span: { from: 0, to: 36 },
    })
    expect(after).toStrictEqual({ _tag: "Text", text: " x", span: { from: 36, to: 38 } })
    expect(parseInline("![s](a.png){not size}")[1]).toStrictEqual({
      _tag: "Text",
      text: "{not size}",
      span: { from: 11, to: 21 },
    })
  })

  it("leaves snake_case, lone markers and unclosed brackets as text", () => {
    expect(show(parseInline("snake_case_name a * b == c [[open #"))).toStrictEqual([
      "Text(snake_case_name a * b == c [[open #)@0-35",
    ])
  })

  it("offsets spans by the line's position in the block", () => {
    expect(show(parseInline("x [[y]]", 10))).toStrictEqual(["Text(x )@10-12", "PageRef(y)@12-17"])
  })

  it("gives back the text a reader sees", () => {
    expect(plainText(parseInline("Morning **check** in the [[Garden Plan]] #today"))).toBe(
      "Morning check in the [[Garden Plan]] #today",
    )
  })

  it("finds the same refs as analyzeBlock on a line", () => {
    const fragment = fc.constantFrom(
      "plain",
      "words here",
      "[[Garden Plan]]",
      "[[projects/Greenhouse]]",
      "#design",
      "#[[visual check]]",
      `((${uuid}))`,
      "`code [[x]]`",
      "**bold [[y]]**",
      "*it #z*",
      "==mark [[m]]==",
      "{{embed [[e]]}}",
      "{{query [[q]]}}",
      "[label]([[p]])",
      "[link](https://example.com)",
      "https://example.com/#anchor",
      "TODO",
      "[#B]",
      "#tag.",
      "(#paren)",
    )

    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 8 }), (fragments) => {
        const line = fragments.join(" ")

        const expected = analyzeBlock(line).refs.map((ref) =>
          ref._tag === "BlockRef" ? `BlockRef:${ref.uuid}` : `${ref._tag}:${ref.name}`,
        )

        expect(refsOf(parseInline(line)).toSorted()).toStrictEqual(expected.toSorted())
      }),
      { numRuns: 1000 },
    )
  })
})

const org = (source: string) => show(parseInline(source, 0, "org"))

describe("org inline syntax", () => {
  it("reads Org emphasis, verbatim and code as Logseq's mldoc does", () => {
    expect(org("x *b* /i/ _u_ +s+ =v= ~c~ ^^h^^")).toStrictEqual([
      "Text(x )@0-2",
      "Bold[Text(b)@3-4]@2-5",
      "Text( )@5-6",
      "Italic[Text(i)@7-8]@6-9",
      "Text( )@9-10",
      "Underline[Text(u)@11-12]@10-13",
      "Text( )@13-14",
      "Strike[Text(s)@15-16]@14-17",
      "Text( )@17-18",
      "Code(v)@18-21",
      "Text( )@21-22",
      "Code(c)@22-25",
      "Text( )@25-26",
      "Highlight[Text(h)@28-29]@26-31",
    ])
  })

  it("reads Org bracket links as links, page refs and block refs", () => {
    expect(
      org(
        `[[https://x.com][label]] [[Page]] [[Page][Lbl]] [[file:../pages/foo.org][Foo]] [[id:${uuid}][x]] **b** \`c\``,
      ),
    ).toStrictEqual([
      "Link(Url:https://x.com)[Text(label)@17-22]@0-24",
      "Text( )@24-25",
      "PageRef(Page)@25-33",
      "Text( )@33-34",
      "Link(Page:Page)[Text(Lbl)@42-45]@34-47",
      "Text( )@47-48",
      "Link(Page:Foo)[Text(Foo)@73-76]@48-78",
      "Text( )@78-79",
      `Link(Block:${uuid})[Text(x)@122-123]@79-125`,
      "Text( *)@125-127",
      "Bold[Text(b)@128-129]@127-130",
      "Text(* `c`)@130-135",
    ])
  })
})
