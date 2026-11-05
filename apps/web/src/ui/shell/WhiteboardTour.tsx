import { useAtom, useAtomSet } from "@effect/atom-react"
import { IconPlayerSkipForward } from "@tabler/icons-react"
import { useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { Atom } from "effect/reactivity"
import { useId } from "react"
import { logseq, names } from "@seqno/dom"
import { leftSidebarOpen } from "../../atoms.ts"
import { isDemoGraph } from "../../graph-locations.ts"
import { closeDialogOf } from "./popover.tsx"
import { setting } from "./state.ts"

const whiteboardTourSeen = setting("seqno.whiteboardTour", Schema.Boolean, false)

const welcomeOpen = Atom.make(false).pipe(Atom.keepAlive)

const tourStep = Atom.make<0 | 1 | null>(null).pipe(Atom.keepAlive)

export const useWhiteboardWelcome = (graph: string) => {
  const [seen, setSeen] = useAtom(whiteboardTourSeen)
  const open = useAtomSet(welcomeOpen)

  return () => {
    if (seen || isDemoGraph(graph) || /Mobi/u.test(navigator.userAgent)) {
      return
    }

    open(true)
    setSeen(true)
  }
}

export const WhiteboardWelcome = () => {
  const [open, setOpen] = useAtom(welcomeOpen)
  const startTour = useAtomSet(tourStep)
  const showSidebar = useAtomSet(leftSidebarOpen)
  const title = useId()

  if (!open) {
    return null
  }

  return (
    <dialog
      className={names(logseq("dialog").className, "seqno-whiteboard-welcome-dialog")}
      aria-labelledby={title}
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
      onClose={() => {
        setOpen(false)
      }}
    >
      <div {...logseq("seqno-whiteboard-welcome")}>
        <span {...logseq("seqno-whiteboard-welcome-hero")} aria-hidden />
        <h1 id={title}>A new canvas for your thoughts.</h1>
        <p>
          Whiteboards are a great tool for brainstorming and organization. Now you can place any of
          your thoughts from the knowledge base or new ones next to each other on a spatial canvas
          to connect, associate and understand in new ways.
        </p>
        <div className="seqno-whiteboard-welcome-actions">
          <button
            type="button"
            className={names("button-secondary", logseq("seqno-whiteboard-welcome-skip").className)}
            onClick={(event) => closeDialogOf(event.currentTarget)}
          >
            Skip
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={(event) => {
              showSidebar(true)
              startTour(0)
              closeDialogOf(event.currentTarget)
            }}
          >
            Start whiteboarding
          </button>
        </div>
      </div>
    </dialog>
  )
}

const steps = [
  {
    id: "whiteboard-home",
    title: "🖼 Home for your whiteboards",
    body: "Whiteboards have their own section in the app where you can see them at a glance, create new ones or delete them easily.",
  },
  {
    id: "whiteboard-new",
    title: "🆕️ Create new whiteboard",
    body: "There are multiple ways of creating a new whiteboard. One of them is always right here in the dashboard.",
  },
] as const

export const WhiteboardTour = () => {
  const [step, setStep] = useAtom(tourStep)
  const navigate = useNavigate()
  const title = useId()

  if (step === null) {
    return null
  }

  const shown = steps[step]

  const end = () => {
    setStep(null)
  }

  const next = () => {
    if (step === 1) {
      end()

      return
    }

    void navigate({ to: "/whiteboards" })
    setStep(1)
  }

  return (
    <div className="seqno-tour" data-step={shown.id}>
      <div {...logseq("seqno-tour-shade")} data-side="top" />
      <div {...logseq("seqno-tour-shade")} data-side="bottom" />
      <div {...logseq("seqno-tour-shade")} data-side="left" />
      <div {...logseq("seqno-tour-shade")} data-side="right" />
      <div
        key={shown.id}
        role="dialog"
        aria-labelledby={title}
        tabIndex={0}
        {...logseq("seqno-tour-step", shown.id)}
        ref={(node) => node?.focus({ preventScroll: true })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            end()
          } else if (event.key === "ArrowRight") {
            next()
          } else if (event.key === "ArrowLeft" && step === 1) {
            setStep(0)
          }
        }}
      >
        <div {...logseq("seqno-tour-arrow")} />
        <div {...logseq("seqno-tour-text")}>
          <h2 id={title}>{shown.title}</h2>
          <p>{shown.body}</p>
          <div {...logseq("seqno-tour-steps")}>
            <strong>STEP {step + 1}</strong>
            <ul>
              {steps.map((each, index) => (
                <li
                  key={each.id}
                  {...logseq("seqno-tour-dot", index === step)}
                  data-active={index === step}
                >
                  {index}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <footer {...logseq("seqno-tour-footer")}>
          {step === 0 ? (
            <button type="button" {...logseq("seqno-tour-button", false)} onClick={next}>
              Next
            </button>
          ) : (
            <>
              <button
                type="button"
                {...logseq("seqno-tour-button", true)}
                data-back
                onClick={() => {
                  setStep(0)
                }}
              >
                Back
              </button>
              <button type="button" {...logseq("seqno-tour-button", false)} onClick={end}>
                Finish
              </button>
            </>
          )}
        </footer>
      </div>
      <button type="button" {...logseq("seqno-tour-skip")} onClick={end}>
        <span>
          <IconPlayerSkipForward size={18} aria-hidden />
          Skip Quick Tour
        </span>
      </button>
    </div>
  )
}
