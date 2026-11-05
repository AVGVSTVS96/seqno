import { spring as physics } from "motion"

export const spring = {
  fast: { type: physics, visualDuration: 0.2, bounce: 0 },
  base: { type: physics, visualDuration: 0.35, bounce: 0.15 },
  slow: { type: physics, visualDuration: 0.6, bounce: 0.25 },
} as const
