export interface SelectorNames {
  readonly classes: readonly string[]
  readonly ids: readonly string[]
  readonly attributes: readonly string[]
}

const preludes = (css: string) =>
  css
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/url\([^)]*\)/gu, "")
    .split(/[{};]/u)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith("@") && !/^[\w-]+\s*:[^:]/u.test(part))

const matches = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((hit) => hit[1] ?? "")

const sorted = (names: Iterable<string>) =>
  [...new Set(names)].filter((name) => name !== "").toSorted()

export const selectorNames = (css: string): SelectorNames => {
  const selectors = preludes(css)

  return {
    classes: sorted(
      selectors.flatMap((selector) => matches(selector, /\.(-?[_a-zA-Z][\w-]*)(?![\w\\-])/gu)),
    ),
    ids: sorted(selectors.flatMap((selector) => matches(selector, /#(-?[_a-zA-Z][\w-]*)/gu))),
    attributes: sorted(selectors.flatMap((selector) => matches(selector, /\[([a-zA-Z][\w-]*)/gu))),
  }
}
