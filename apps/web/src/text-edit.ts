export interface TextEdit {
  readonly from: number
  readonly to: number
  readonly insert: string
}

const sharedPrefix = (before: string, after: string) => {
  const limit = Math.min(before.length, after.length)
  const at = Array.from({ length: limit }, (_, index) => index).find(
    (index) => before[index] !== after[index],
  )
  return at ?? limit
}

const sharedSuffix = (before: string, after: string, prefix: number) => {
  const limit = Math.min(before.length, after.length) - prefix
  const at = Array.from({ length: limit }, (_, index) => index).find(
    (index) => before[before.length - 1 - index] !== after[after.length - 1 - index],
  )
  return at ?? limit
}

export const textEdit = (before: string, after: string): TextEdit => {
  const prefix = sharedPrefix(before, after)
  const suffix = sharedSuffix(before, after, prefix)
  return {
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  }
}
