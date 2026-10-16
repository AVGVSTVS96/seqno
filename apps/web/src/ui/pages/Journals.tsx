import { useAtomValue } from "@effect/atom-react"
import { useVirtualList } from "@seqno/outliner"
import { journals } from "../../atoms.ts"
import { PageView } from "../PageView.tsx"
import { today } from "./atoms.ts"

const estimateDay = () => 600

const Gap = ({ height }: { readonly height: number }) => (
  <div className="seqno-journals-gap" aria-hidden style={{ height }} />
)

export const Journals = () => {
  const until = useAtomValue(today)
  const days = useAtomValue(journals).filter((page) => (page.journalDay ?? 0) <= until)
  const { placed, trailing, attach, measure } = useVirtualList({
    id: "journals",
    windowed: true,
    count: days.length,
    estimate: estimateDay,
    key: (index) => days[index]?.id ?? index,
    overscan: 2,
  })
  return (
    <div ref={attach} className="seqno-journals">
      {placed.flatMap(({ index, gap }) => {
        const page = days[index]
        if (page === undefined) return []
        const day = (
          <div key={page.id} ref={measure} data-index={index} className="seqno-journal">
            <PageView page={page} zoom={null} inJournals />
          </div>
        )
        return gap === 0 ? [day] : [<Gap key={`gap-${page.id}`} height={gap} />, day]
      })}
      {trailing === 0 ? null : <Gap key="gap-end" height={trailing} />}
    </div>
  )
}
