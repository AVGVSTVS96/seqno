import { RuleTester } from "oxlint/plugins-dev"
import { describe, it } from "vitest"
import noComments from "../src/no-comments.ts"
import { logseqNames } from "../src/logseq-names.ts"

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } })
const noCommentsRule = noComments.rules["no-comments"]

if (noCommentsRule === undefined) {
  throw new Error("the no-comments plugin lost its rule")
}

tester.run("no-comments", noCommentsRule, {
  valid: [
    "const total = 1",
    "// https://github.com/loro-dev/loro/issues/1 tree moves drop the fractional index\nconst x = 1",
    "// SAFETY: the worker only ever posts Commands\nconst x = 1",
    "// oxlint-disable-next-line no-console -- the CLI's output\nconsole.log(1)",
  ],
  invalid: [
    { code: "// increments the counter\nconst x = 1", errors: [/^Comments are banned/u] },
    { code: "/** docs */\nexport const x = 1", errors: 1 },
    { code: "// oxlint-disable-next-line no-console\nconsole.log(1)", errors: 1 },
  ],
})

tester.run("logseq-names", logseqNames, {
  valid: [
    'const row = <div {...logseq("seqno-row", state)} data-index={1} />',
    'const dot = <span className="seqno-dot" />',
    "const title = <Heading level={2} />",
    'element.className = logseq("seqno-plugin-frame").className',
  ],
  invalid: [
    {
      code: 'const bullet = <span className="seqno-bullet bullet-container" />',
      errors: [
        {
          message:
            "`bullet-container` is one of Logseq's names. Spread `logseq(\"seqno-…\", state)` from @seqno/dom on this element and add Logseq's names to the table there.",
        },
      ],
    },
    {
      code: "const dot = <span id={`dot-${id}`} blockid={id} />",
      errors: [/^`dot-` is one of Logseq's names/u, /^`blockid` is one of Logseq's names/u],
    },
    { code: 'const menu = <div className={names("menu", extra)} />', errors: [/^`menu`/u] },
    { code: 'frame.className = "lsp-iframe-sandbox"', errors: [/^`lsp-iframe-sandbox`/u] },
    { code: 'node.classList.toggle("bullet-closed", folded)', errors: [/^`bullet-closed`/u] },
  ],
})
