import type { JournalDay } from "@seqno/domain"
import type { StarterFile } from "./place.ts"

const journalFile = (day: JournalDay) => {
  const text = String(day)
  return `journals/${text.slice(0, 4)}_${text.slice(4, 6)}_${text.slice(6)}.md`
}

export const demoGraph = (today: JournalDay): ReadonlyArray<StarterFile> => [
  {
    path: journalFile(today),
    text: [
      "- Welcome to the seqno demo graph",
      "- Open [[Getting started]] to see how pages link",
    ].join("\n"),
  },
  {
    path: "pages/Getting started.md",
    text: [
      "- seqno is a local-first outliner. Everything you write is a block, and blocks nest.",
      "- Outline",
      "\t- Click any block to edit it. Enter makes a new block, Tab indents it, Shift+Tab brings it back.",
      "\t- Click a bullet to zoom into a block. Its children come with it.",
      "- Link",
      "\t- Type `[[` to link a page, `#` to tag one, and `((` to point at a single block.",
      "\t- Every page lists what links to it at the bottom. [[Ideas]] links back here.",
      "\t- Shift+click a link to open it in the right sidebar.",
      "- Tasks",
      "\t- TODO Start a block with TODO, or press Ctrl+Enter (Cmd+Enter on a Mac) to cycle it",
      "\t- DOING Type `/` for dates, priorities, headings, code blocks and more",
      "\t- DONE Open this page",
      "- Find",
      "\t- Ctrl+K (Cmd+K on a Mac) searches every page and block.",
      "- Query",
      "\t- Queries stay live as you type. This one lists every open task:",
      "\t- {{query (task TODO DOING)}}",
      "- Your notes",
      "\t- This demo lives in your browser and never leaves it.",
      "\t- In Chrome or Edge you can open a folder of Logseq markdown instead. seqno writes its edit log next to your files, so try it on a copy.",
    ].join("\n"),
  },
  {
    path: "pages/Ideas.md",
    text: [
      "- Loose thoughts go here. This page links back to [[Getting started]].",
      "- LATER Plant tomatoes along the south fence #garden",
      "- Mark what matters: ==like this==",
    ].join("\n"),
  },
]
