import "react"

declare module "react" {
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined
  }
}
