import { useState, useSyncExternalStore } from "react"
import { commits } from "./commits.ts"
import { ago, history } from "./github.ts"

const strip = Array.from({ length: 20 }, (_, n) => <span key={n}>{n % 10}</span>)

export function Odometer() {
  const { count, date } = useSyncExternalStore(commits.subscribe, commits.get, commits.baked)
  const [now, setNow] = useState(() => Date.now())
  const baked = commits.baked().count
  const width = Math.max(4, String(count).length)
  const from = String(baked).padStart(width, "0")
  const to = String(count).padStart(width, "0")
  const last = date ? `, the last one ${ago(date, new Date(now))}` : ""
  const refresh = () => setNow(Date.now())
  return (
    <span className="odo" onPointerEnter={refresh} onFocus={refresh}>
      <a href={history} aria-describedby="odo-tip">
        <span className="no" aria-hidden="true">
          Nº
        </span>
        <span className="digits" aria-hidden="true" data-rolled={count > baked ? "" : undefined}>
          {to.split("").map((digit, i) => {
            const a = Number(from[i] ?? 0)
            const b = Number(digit)
            const position = b >= a ? b : b + 10
            return (
              <span className="cell" key={i}>
                <span className="strip" style={{ transform: `translateY(${-position * 22}px)` }}>
                  {strip}
                </span>
              </span>
            )
          })}
        </span>
        <span className="sr">Nº {count}</span>
      </a>
      <span className="tip" role="tooltip" id="odo-tip">
        {count} changes so far{last}. Every edit you make in seqno gets a number like this in its
        edit log. That's the name: seqno, short for sequence number.
      </span>
    </span>
  )
}
