import type { JournalDay } from "@seqno/domain"
import { defaultConfig, fileBodyFromTitle, formatJournalDay } from "@seqno/interop"
import { journalFile, shiftDay } from "../journal.ts"
import type { StarterFile } from "../place.ts"

export const ids = {
  loro: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e01",
  oneWriter: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e02",
  reword: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e03",
  onlyNever: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e04",
  oneDoor: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e05",
  cache: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e06",
  overshoot: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e07",
  logseqHole: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e08",
  htmlFast: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e09",
  reactDefault: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0a",
  corruptible: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0b",
  everySystem: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0c",
  darkForest: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0d",
  thousandYears: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0e",
  readTheCode: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e0f",
  whereStyles: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e10",
  offNix: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e11",
  patchFormat: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e12",
  antimemetics: "0199c3e2-41a7-7d10-9b2e-5f4c8a1d2e13",
} as const

export const ref = (id: string) => `((${id}))`

export const page = (title: string, ...lines: ReadonlyArray<string>): StarterFile => ({
  path: `pages/${fileBodyFromTitle(title)}.md`,
  text: lines.join("\n"),
})

export const on = (day: JournalDay, ...lines: ReadonlyArray<string>): StarterFile => ({
  path: journalFile(day),
  text: lines.join("\n"),
})

export const dated = (day: JournalDay) =>
  `[[${formatJournalDay(day, defaultConfig.journalTitleFormat)}]]`

export const days = (today: JournalDay) => {
  const day = (offset: number) => shiftDay(today, offset)
  return {
    day,
    date: (offset: number) => dated(day(offset)),
    stamp: (offset: number, repeat = "") =>
      `<${formatJournalDay(day(offset), "yyyy-MM-dd EEE")}${repeat}>`,
    journal: (offset: number, ...lines: ReadonlyArray<string>) => on(day(offset), ...lines),
  }
}

export type Days = ReturnType<typeof days>

export const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`

export const yt = (title: string, id: string) => `[${title}](${watch(id)})`

export const thumb = (title: string, id: string) =>
  `![${title}](https://i.ytimg.com/vi/${id}/hqdefault.jpg)`

export const video = (id: string) => `{{video ${watch(id)}}}`

export const post = (id: string, label = "post") =>
  `[${label}](https://x.com/avgvstvs96/status/${id})`

export const pr = (repo: string, n: number) =>
  `[${repo}#${n}](https://github.com/${repo}/pull/${n})`
