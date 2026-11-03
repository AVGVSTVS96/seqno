export interface SelectorNames {
  readonly classes: ReadonlyArray<string>
  readonly ids: ReadonlyArray<string>
  readonly attributes: ReadonlyArray<string>
}

const preludes = (css: string) =>
  css
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/url\([^)]*\)/g, "")
    .split(/[{};]/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("@") && !/^[\w-]+\s*:[^:]/.test(part))

const matches = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((hit) => hit[1] ?? "")

const sorted = (names: Iterable<string>) =>
  [...new Set(names)].filter((name) => name !== "").toSorted()

export const selectorNames = (css: string): SelectorNames => {
  const selectors = preludes(css)
  return {
    classes: sorted(
      selectors.flatMap((selector) => matches(selector, /\.(-?[_a-zA-Z][\w-]*)(?![\w\\-])/g)),
    ),
    ids: sorted(selectors.flatMap((selector) => matches(selector, /#(-?[_a-zA-Z][\w-]*)/g))),
    attributes: sorted(selectors.flatMap((selector) => matches(selector, /\[([a-zA-Z][\w-]*)/g))),
  }
}
