import type { ReactNode } from "react"

export type CommandIcon = (props: { readonly size: number; readonly stroke: number }) => ReactNode

const bars = [
  { x: 4, top: 14 },
  { x: 10, top: 10 },
  { x: 16, top: 6 },
] as const

const PriorityBars = ({ size, lit }: { readonly size: number; readonly lit: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    {bars.map(({ x, top }, index) => (
      <rect
        key={x}
        x={x}
        y={top}
        width={4}
        height={20 - top}
        rx={1}
        opacity={index < lit ? 1 : 0.3}
      />
    ))}
  </svg>
)

export const priorityBars = (lit: number): CommandIcon => {
  const Icon: CommandIcon = ({ size }) => <PriorityBars size={size} lit={lit} />

  return Icon
}
