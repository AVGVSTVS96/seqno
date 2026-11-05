import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"
import { logseqClasses, logseqIdPrefixes, logseqIds } from "@seqno/dom"

const logseqAttributes = new Set([
  "blockid",
  "haschild",
  "level",
  "data-refs-self",
  "data-ref",
  "data-collapsed",
])

const fix = (name: string) =>
  `\`${name}\` is one of Logseq's names. Spread \`logseq("seqno-…", state)\` from @seqno/dom on this element and add Logseq's names to the table there.`

interface Found {
  readonly node: ESTree.Node
  readonly text: string
}

const isText = (value: Extract<ESTree.Node, { type: "Literal" }>["value"]): value is string =>
  typeof value === "string"

const strings = (node: ESTree.Node | null | undefined): readonly Found[] => {
  if (node === null || node === undefined) {
    return []
  }

  if (node.type === "Literal") {
    return isText(node.value) ? [{ node, text: node.value }] : []
  }

  if (node.type === "TemplateLiteral") {
    return [
      ...node.quasis.flatMap((quasi) =>
        quasi.value.cooked === null || quasi.value.cooked === undefined
          ? []
          : [{ node: quasi, text: quasi.value.cooked }],
      ),
      ...node.expressions.flatMap(strings),
    ]
  }

  if (node.type === "JSXExpressionContainer") {
    return node.expression.type === "JSXEmptyExpression" ? [] : strings(node.expression)
  }

  if (node.type === "ConditionalExpression") {
    return [...strings(node.consequent), ...strings(node.alternate)]
  }

  if (node.type === "LogicalExpression" || node.type === "BinaryExpression") {
    return [...strings(node.left), ...strings(node.right)]
  }

  if (node.type === "CallExpression") {
    return node.arguments.flatMap(strings)
  }

  if (node.type === "ArrayExpression") {
    return node.elements.flatMap(strings)
  }

  if (node.type === "SpreadElement") {
    return strings(node.argument)
  }

  return []
}

const tokens = (text: string) => text.split(/\s+/u).filter((token) => token !== "")

const isClass = (token: string) => logseqClasses.has(token)

const isId = (token: string) =>
  logseqIds.has(token) || logseqIdPrefixes.some((prefix) => token.startsWith(prefix))

const check = (
  context: Context,
  values: ReadonlyArray<ESTree.Node | null | undefined>,
  isName: (token: string) => boolean,
) => {
  for (const { node, text } of values.flatMap(strings)) {
    for (const token of tokens(text)) {
      if (isName(token)) {
        context.report({ node, message: fix(token) })
      }
    }
  }
}

const intrinsic = (element: ESTree.JSXOpeningElement) =>
  element.name.type === "JSXIdentifier" && /^[a-z]/u.test(element.name.name)

export const logseqNames = defineRule({
  create: (context) => ({
    JSXAttribute: (node) => {
      if (node.name.type !== "JSXIdentifier") {
        return
      }

      const name = node.name.name

      if (name === "className") {
        check(context, [node.value], isClass)
      }

      if (name === "id") {
        check(context, [node.value], isId)
      }

      if (
        logseqAttributes.has(name) &&
        node.parent.type === "JSXOpeningElement" &&
        intrinsic(node.parent)
      ) {
        context.report({ node, message: fix(name) })
      }
    },
    AssignmentExpression: (node) => {
      if (node.left.type !== "MemberExpression" || node.left.property.type !== "Identifier") {
        return
      }

      if (node.left.property.name === "className") {
        check(context, [node.right], isClass)
      }

      if (node.left.property.name === "id") {
        check(context, [node.right], isId)
      }
    },
    CallExpression: (node) => {
      const callee = node.callee

      if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") {
        return
      }

      const method = callee.property.name

      const onClassList =
        callee.object.type === "MemberExpression" &&
        callee.object.property.type === "Identifier" &&
        callee.object.property.name === "classList"

      if (onClassList && ["add", "remove", "toggle", "replace"].includes(method)) {
        check(context, node.arguments, isClass)
      }

      const [attribute, value] = node.arguments

      if (method === "setAttribute" && attribute?.type === "Literal") {
        if (attribute.value === "class") {
          check(context, [value], isClass)
        }

        if (attribute.value === "id") {
          check(context, [value], isId)
        }

        if (isText(attribute.value) && logseqAttributes.has(attribute.value)) {
          context.report({ node: attribute, message: fix(attribute.value) })
        }
      }
    },
  }),
})
