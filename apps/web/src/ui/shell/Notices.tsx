import { useAtom } from "@effect/atom-react"
import { IconAlertCircle, IconX } from "@tabler/icons-react"
import { Atom, type AtomRegistry } from "effect/reactivity"

interface Notice {
  readonly id: number
  readonly message: string
}

const shownFor = 2000

export const notices = Atom.make<ReadonlyArray<Notice>>([]).pipe(Atom.keepAlive)

let lastId = 0

export const notify = (registry: AtomRegistry.AtomRegistry, message: string) => {
  lastId += 1
  const id = lastId
  registry.update(notices, (shown) => [
    ...shown.filter((notice) => notice.message !== message),
    { id, message },
  ])
  setTimeout(
    () => registry.update(notices, (shown) => shown.filter((notice) => notice.id !== id)),
    shownFor,
  )
}

export const Notices = () => {
  const [shown, setShown] = useAtom(notices)
  return (
    <div className="notices" role="status" aria-live="polite">
      {shown.map((notice) => (
        <div key={notice.id} className="notice">
          <IconAlertCircle className="notice-icon" size={20} stroke={2} aria-hidden />
          <p className="notice-message">{notice.message}</p>
          <button
            type="button"
            className="notice-close"
            aria-label="Close"
            onClick={() => setShown(shown.filter((other) => other.id !== notice.id))}
          >
            <IconX size={18} stroke={2} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
