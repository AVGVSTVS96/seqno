import type { CSSProperties as ReactCSSProperties } from "react"

declare module "react" {
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined
  }
}

export type { ReactCSSProperties }
