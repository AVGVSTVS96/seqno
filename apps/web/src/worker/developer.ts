import type { JournalDay } from "@seqno/domain"
import { hub } from "./developer/hub.ts"
import { days } from "./developer/kit.ts"
import { projects } from "./developer/projects.ts"
import { recent } from "./developer/recent.ts"
import { topics } from "./developer/topics.ts"
import { y2023 } from "./developer/y2023.ts"
import { y2024 } from "./developer/y2024.ts"
import { y2025 } from "./developer/y2025.ts"
import { y2026 } from "./developer/y2026.ts"
import type { StarterFile } from "./place.ts"

export const developerGraph = (today: JournalDay): ReadonlyArray<StarterFile> => {
  const d = days(today)
  return [
    ...recent(d),
    ...y2026,
    ...y2025,
    ...y2024,
    ...y2023,
    ...hub(d),
    ...projects(d),
    ...topics(d),
  ]
}
