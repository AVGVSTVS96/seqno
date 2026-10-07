export const onMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

export const isMoveChord = (event: {
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}) => event.shiftKey && (onMac ? event.metaKey : event.altKey)
