import { useAtomSet } from "@effect/atom-react"
import { IconAlertTriangle } from "@tabler/icons-react"
import { Exit } from "effect"
import { useId } from "react"
import type { Page } from "@seqno/domain"
import { dispatch } from "../../atoms.ts"
import { closeDialogOf, Dialog } from "./popover.tsx"

export const DeletePage = ({
  id,
  page,
  onClose,
  onDeleted,
}: {
  readonly id: string
  readonly page: Page
  readonly onClose: () => void
  readonly onDeleted: () => void
}) => {
  const run = useAtomSet(dispatch, { mode: "promiseExit" })
  const title = useId()

  const remove = async (from: HTMLElement) => {
    closeDialogOf(from)

    if (Exit.isSuccess(await run({ _tag: "DeletePage", pageId: page.id }))) {
      onDeleted()
    }
  }

  return (
    <Dialog
      id={id}
      label="Delete page"
      className="confirm"
      onClose={onClose}
      ref={(dialog) => {
        if (dialog !== null && !dialog.open) {
          dialog.showModal()
        }
      }}
    >
      <div className="confirm-body" aria-labelledby={title}>
        <h2 id={title} className="confirm-title">
          <IconAlertTriangle size={18} aria-hidden />
          Are you sure you want to delete this page?
        </h2>
        <p className="confirm-detail">- {page.title}</p>
        <div className="confirm-actions">
          <button
            type="button"
            className="button-outline"
            onClick={(event) => closeDialogOf(event.currentTarget)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={(event) => {
              void remove(event.currentTarget)
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </Dialog>
  )
}
