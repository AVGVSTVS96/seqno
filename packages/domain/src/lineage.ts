export interface Root {
  readonly peer: string
  readonly imported: boolean
}

export const importMessage = "seqno:import"
