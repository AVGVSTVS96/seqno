type Token = string | false | null | undefined

const isName = (token: Token): token is string => typeof token === "string" && token !== ""

export const names = (...tokens: readonly Token[]) => tokens.filter(isName).join(" ")

export interface LogseqNames {
  readonly className: string
  readonly id?: string
  readonly blockid?: string
  readonly level?: number
  readonly haschild?: "true" | "false"
  readonly [data: `data-${string}`]: string | true | undefined
}

export type Table<P extends { readonly [K in keyof P]: readonly unknown[] }> = {
  readonly [K in keyof P]: (...state: P[K]) => LogseqNames
}

export const attributesOf = (made: LogseqNames): Record<string, string> =>
  Object.fromEntries(
    Object.entries(made).flatMap(([name, value]) =>
      value === undefined || value === false
        ? []
        : [[name === "className" ? "class" : name, value === true ? "" : String(value)]],
    ),
  )
