import { analyzeBlock, applyEdit } from "./block.ts"
import type { Ref, TextEdit } from "./block.ts"
import { TAG_TRAILER } from "./patterns.ts"

const BARE_TAG = /^[^\s#,;!?"'()[\]{}+][^\s,;!?"'()[\]{}]*$/u

const written = (ref: Ref, source: string, title: string): string => {
  if (ref._tag === "Tag") {
    const bare = !source.startsWith("#[[") && BARE_TAG.test(title) && !TAG_TRAILER.test(title)

    return bare ? `#${title}` : `#[[${title}]]`
  }

  return source.startsWith("[[") || title.includes(",") ? `[[${title}]]` : title
}

export const renameRefs = (
  text: string,
  renamed: (name: string) => boolean,
  title: string,
): readonly TextEdit[] =>
  analyzeBlock(text)
    .refs.flatMap((ref): readonly TextEdit[] =>
      ref._tag !== "BlockRef" && renamed(ref.name)
        ? [
            {
              from: ref.span.from,
              to: ref.span.to,
              insert: written(ref, text.slice(ref.span.from, ref.span.to), title),
            },
          ]
        : [],
    )
    .toReversed()

export const renameInProperty = (
  key: string,
  value: string,
  renamed: (name: string) => boolean,
  title: string,
): string => {
  const line = `${key}:: ${value}`

  return renameRefs(line, renamed, title)
    .reduce(applyEdit, line)
    .slice(line.length - value.length)
}
