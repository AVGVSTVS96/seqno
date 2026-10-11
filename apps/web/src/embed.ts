export const embedded =
  window.parent !== window && new URLSearchParams(location.search).has("embed")

export const canPickFolders = "showDirectoryPicker" in window && !embedded

export const toParent = (type: "ready" | "escape") =>
  window.parent.postMessage({ type: `seqno:${type}` }, "*")

const closesNatively = () =>
  document.querySelector("[popover=auto]:popover-open, dialog:modal") !== null

export const forwardEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape" && !event.defaultPrevented && !closesNatively()) toParent("escape")
}
