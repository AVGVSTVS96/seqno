export const embedded =
  window.parent !== window && new URLSearchParams(location.search).has("embed")

export const canPickFolders = "showDirectoryPicker" in window && !embedded

export const toParent = (type: "ready") => window.parent.postMessage({ type: `seqno:${type}` }, "*")
