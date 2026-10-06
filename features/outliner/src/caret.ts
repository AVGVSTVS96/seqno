export const caretFromPoint = (x: number, y: number): number | null => {
  const position = document.caretPositionFromPoint(x, y)
  const node = position?.offsetNode
  const host = node instanceof Text ? node.parentElement?.closest("[data-from]") : null
  if (position === null || !(host instanceof HTMLElement)) return null
  const from = Number(host.dataset["from"])
  return Number.isInteger(from) ? from + position.offset : null
}

export const hasTextSelection = () => {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString() !== ""
}
