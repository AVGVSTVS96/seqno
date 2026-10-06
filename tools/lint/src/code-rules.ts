import { defineRule } from "@oxlint/plugins"

const effectHooks = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"])

export const noComments = defineRule({
  create: (context) => ({
    Program: () => {
      for (const comment of context.sourceCode.getAllComments()) {
        if (!comment.value.includes("https://")) {
          context.report({
            node: comment,
            message:
              "Code comments are not allowed. Make the code say it instead: rename, extract a named function, or encode the fact in a type. The one exception is an outside fact the code cannot express (an upstream bug, a spec quirk): keep that comment only with the https:// link to its source.",
          })
        }
      }
    },
  }),
})

export const noUseEffect = defineRule({
  create: (context) => {
    const reported = new Set<number>()
    return {
      Identifier: (node) => {
        if (effectHooks.has(node.name) && !reported.has(node.start)) {
          reported.add(node.start)
          context.report({
            node,
            message: `${node.name} is not allowed. Derive the value during render, do the work in the event handler that caused the change, or read outside state through an @effect/atom-react atom (useAtomValue, useAtomSet).`,
          })
        }
      },
    }
  },
})

const asCastMessage =
  "Type assertions are not allowed. Decode unknown data with Schema.decodeUnknown*, narrow with a Predicate guard or Match, or fix the type where the value is made. Only 'as const' is allowed."

export const noAsCast = defineRule({
  create: (context) => ({
    TSAsExpression: (node) => {
      const type = node.typeAnnotation
      const isConst =
        type.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        type.typeName.name === "const"
      if (!isConst) {
        context.report({ node, message: asCastMessage })
      }
    },
    TSTypeAssertion: (node) => {
      context.report({ node, message: asCastMessage })
    },
  }),
})

export const noAny = defineRule({
  create: (context) => ({
    TSAnyKeyword: (node) => {
      context.report({
        node,
        message:
          "'any' is not allowed. Use 'unknown' and decode it with Schema, or write the real type.",
      })
    },
  }),
})
