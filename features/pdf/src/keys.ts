import type { KeyboardEvent } from "react"

export const activates =
  <E extends Element>(run: (event: KeyboardEvent<E>) => void) =>
  (event: KeyboardEvent<E>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      run(event)
    }
  }
