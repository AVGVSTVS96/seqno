import { inView } from "motion"
import { animate } from "motion/mini"
import { spring } from "./motion.ts"
import { offscreen } from "./reveal.ts"

const updates = [0, 412, 577, 809]
const secondsPerEdit = 0.003

function write(tree: HTMLElement | null) {
  if (!tree || !offscreen(tree)) return
  const files = [...tree.querySelectorAll<HTMLElement>(".file")]
  for (const file of files) file.style.opacity = "0"
  const stop = inView(
    tree,
    () => {
      stop()
      files.forEach((file, i) =>
        animate(
          file,
          { opacity: [0, 1], transform: ["translateY(6px)", "translateY(0)"] },
          { ...spring.base, delay: (updates[i] ?? 0) * secondsPerEdit },
        ),
      )
    },
    { amount: 0.7 },
  )
  return stop
}

export function Folder() {
  return (
    <figure
      className="folder"
      ref={write}
      role="img"
      aria-label="A graph folder with Logseq's files and seqno's numbered edit files"
    >
      <ul className="tree outline">
        <li>
          <span>my-graph/</span>
          <ul>
            <li className="quiet">
              <span>journals/ &nbsp;pages/ &nbsp;logseq/ &nbsp;assets/</span>
            </li>
            <li>
              <span>updates/web-3f9a1c07e2b/</span>
              <ul>
                <li>
                  <span className="files">
                    {updates.map((n, i) => (
                      <span key={n} className={i === updates.length - 1 ? "file newest" : "file"}>
                        <b>{n}</b>.loro
                      </span>
                    ))}
                  </span>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    </figure>
  )
}
