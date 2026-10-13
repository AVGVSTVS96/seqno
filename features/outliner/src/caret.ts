export const caretFromPoint = (x: number, y: number): number | null => {
  const position = document.caretPositionFromPoint(x, y)
  const node = position?.offsetNode
  if (position === null || !(node instanceof Text)) return null
  const host = node.parentElement?.closest("[data-from]")
  if (!(host instanceof HTMLElement) || host.closest(".seqno-attrs") !== null) return null
  const { from, start, end } = host.dataset
  const edge = position.offset === 0 ? start : position.offset === node.length ? end : undefined
  const caret = edge === undefined ? Number(from) + position.offset : Number(edge)
  return Number.isInteger(caret) ? caret : null
}

export const hasTextSelection = () => {
  const selection = window.getSelection()
  return selection !== null && !selection.isCollapsed && selection.toString() !== ""
}
