import type { JournalDay } from "@seqno/domain"
import { builds } from "./developer/builds.ts"
import { fall } from "./developer/fall.ts"
import { hub } from "./developer/hub.ts"
import { days } from "./developer/kit.ts"
import { power } from "./developer/power.ts"
import { projects } from "./developer/projects.ts"
import { topics } from "./developer/topics.ts"
import { y2023 } from "./developer/y2023.ts"
import { y2024 } from "./developer/y2024.ts"
import { y2025 } from "./developer/y2025.ts"
import { y2026 } from "./developer/y2026.ts"
import type { StarterFile } from "./place.ts"

const oneFilePerPath = (files: readonly StarterFile[]) => {
  const merged = new Map<string, string>()

  for (const file of files) {
    const before = merged.get(file.path)
    merged.set(file.path, before === undefined ? file.text : `${before}\n${file.text}`)
  }

  return [...merged].map(([path, text]) => ({ path, text }))
}

export const developerGraph = (today: JournalDay): readonly StarterFile[] => {
  const d = days(today)

  return oneFilePerPath([
    ...fall,
    ...y2026,
    ...y2025,
    ...y2024,
    ...y2023,
    ...power,
    ...hub(d),
    ...projects(d),
    ...builds,
    ...topics,
  ])
}
