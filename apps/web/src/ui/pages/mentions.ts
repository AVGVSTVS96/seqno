const highlightName = "seqno-mention"

const sharedHighlight = () => {
  const existing = CSS.highlights.get(highlightName)
  if (existing !== undefined) return existing
  const created = new Highlight()
  CSS.highlights.set(highlightName, created)
  return created
}

const escape = (word: string) => word.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const wordsOf = (names: ReadonlyArray<string>) => [
  ...new Set(names.flatMap((name) => name.split(/[^\p{L}\p{N}]+/u)).filter((word) => word !== "")),
]

const skipped = "nav, textarea, input, [contenteditable='true']"

export const markMentions = (words: ReadonlyArray<string>) => (element: HTMLElement | null) => {
  if (element === null || words.length === 0) return
  const highlight = sharedHighlight()
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${words.map(escape).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  )
  let ranges: ReadonlyArray<Range> = []
  const mark = () => {
    for (const range of ranges) highlight.delete(range)
    const found: Array<Range> = []
    for (const reference of element.querySelectorAll(".seqno-reference")) {
      const root = reference.querySelector("[role=treeitem]")
      if (root === null) continue
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.parentElement?.closest(skipped) != null) continue
        for (const match of (node.textContent ?? "").matchAll(pattern)) {
          const range = new Range()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          found.push(range)
          highlight.add(range)
        }
      }
    }
    ranges = found
  }
  mark()
  const observer = new MutationObserver(mark)
  observer.observe(element, { subtree: true, childList: true, characterData: true })
  return () => {
    observer.disconnect()
    for (const range of ranges) highlight.delete(range)
  }
}
