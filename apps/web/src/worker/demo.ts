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
      "favorite:: true",
      "",
      "- seqno is a local-first outliner",
      "\t- Every block is markdown source",
      "\t- Click a block to edit it",
      "- Search lives in the left sidebar, tagged #seqno",
    ].join("\n"),
  },
  { path: "pages/Ideas.md", text: "- A page with one block" },
]
