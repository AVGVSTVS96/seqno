import type { Marker } from "@seqno/syntax"

export const switchable: Partial<Record<Marker, Marker>> = {
  TODO: "DOING",
  DOING: "TODO",
  LATER: "NOW",
  NOW: "LATER",
}

const cycle: Record<Marker, Marker | null> = {
  TODO: "DOING",
  DOING: "DONE",
  LATER: "NOW",
  NOW: "DONE",
  WAIT: "DONE",
  WAITING: "DONE",
  "IN-PROGRESS": "DONE",
  STARTED: "DONE",
  DONE: null,
  CANCELED: null,
  CANCELLED: null,
}

export const nextMarker = (marker: Marker | null): Marker | null =>
  marker === null ? "TODO" : cycle[marker]

export const isCanceled = (marker: Marker | null) => marker === "CANCELED" || marker === "CANCELLED"

export const taskState = (marker: Marker | null) =>
  marker === "DONE" ? "done" : isCanceled(marker) ? "canceled" : undefined
