import { inView } from "motion"
import { animate } from "motion/mini"
import { spring } from "./motion.ts"
import { offscreen } from "./reveal.ts"

const updates = [0, 412, 577, 809]
const secondsPerEdit = 0.001

function write(tree: HTMLElement | null) {
  if (!tree || !offscreen(tree)) {
    return
  }

  const files = [...tree.querySelectorAll<HTMLElement>(".file")]

  for (const file of files) {
    file.style.opacity = "0"
  }

  const stop = inView(
    tree,
    () => {
      stop()

      for (const [i, file] of files.entries()) {
        void animate(
          file,
          { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0)"] },
          { ...spring.base, delay: (updates[i] ?? 0) * secondsPerEdit },
        )
      }
    },
    { amount: 0.1 },
  )

  return stop
}

export function Folder() {
  return (
    <figure
      className="ledger"
      ref={write}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a file tree drawn as one labelled image; an <img> can't hold markup
      role="img"
      aria-label="A graph folder with Logseq's files and seqno's numbered edit files"
    >
      <p>my-graph/</p>
      <p className="in quiet">journals/ pages/ logseq/ assets/</p>
      <p className="in">updates/web-3f9a1c07e2b/</p>
      {updates.map((n, i) => (
        <p key={n} className={i === updates.length - 1 ? "in in2 file newest" : "in in2 file"}>
          ‹peer›-<b>{n}</b>.loro
          {i === updates.length - 1 && (
            <span className="mark" aria-hidden="true">
              1
            </span>
          )}
        </p>
      ))}
    </figure>
  )
}
