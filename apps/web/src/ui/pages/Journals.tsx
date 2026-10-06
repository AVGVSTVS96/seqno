import { useAtomValue } from "@effect/atom-react"
import { useState } from "react"
import { journals } from "../../atoms.ts"
import { PageView } from "../PageView.tsx"
import { today } from "./atoms.ts"

const firstBatch = 3
const batch = 3
const ahead = "1200px 0px"

const whenNear = (onNear: () => void) => (element: HTMLDivElement | null) => {
  if (element === null) return
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onNear()
    },
    { rootMargin: ahead, scrollMargin: ahead },
  )
  observer.observe(element)
  return () => observer.disconnect()
}

export const Journals = () => {
  const until = useAtomValue(today)
  const days = useAtomValue(journals).filter((page) => (page.journalDay ?? 0) <= until)
  const [shown, setShown] = useState(firstBatch)
  return (
    <div className="seqno-journals">
      {days.slice(0, shown).map((page) => (
        <div key={page.id} className="seqno-journal">
          <PageView page={page} zoom={null} inJournals />
        </div>
      ))}
      {shown < days.length ? (
        <div
          key={shown}
          className="seqno-journals-more"
          aria-hidden
          ref={whenNear(() => setShown((current) => Math.max(current, shown + batch)))}
        />
      ) : null}
    </div>
  )
}
