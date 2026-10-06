export const at = <T>(items: ReadonlyArray<T>, index: number): T => {
  const item = items[index]
  if (item === undefined) {
    throw new RangeError(`index ${index} is outside 0..${items.length - 1}`)
  }
  return item
}

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a === b || (a.length === b.length && a.every((value, i) => value === b[i]))

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

export const splitPath = (path: string): readonly [dir: string, name: string] => {
  const slash = path.lastIndexOf("/")
  return [path.slice(0, slash), path.slice(slash + 1)]
}

export const stubTarget = (name: string): string | undefined => /^\.(.+)\.icloud$/.exec(name)?.[1]
