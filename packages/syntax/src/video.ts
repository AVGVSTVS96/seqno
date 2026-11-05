export type Video =
  | { readonly _tag: "YouTube"; readonly id: string; readonly start: number }
  | { readonly _tag: "Vimeo"; readonly id: string; readonly hash: string | null }
  | { readonly _tag: "File"; readonly url: string }

const YOUTUBE =
  /^(?:(?:https?:)?\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})(?![\w-])/iu

const YOUTUBE_START = /[?&#](?:t|start)=([\dhms]+)/iu

const VIMEO =
  /^(?:(?:https?:)?\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/|channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d+)(?:\/([\da-f]+))?(?![\w-])/iu

const VIMEO_HASH = /[?&]h=([\da-f]+)/iu
const FILE = /^[^\s?#]+\.(?:mp4|m4v|webm|ogv|mov)(?:[?#]\S*)?$/iu
const CLOCK = /^(?:(\d+):)?([0-5]?\d):([0-5]?\d)$/u
const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/iu

const durationSeconds = (text: string): number => {
  const [, hours = "0", minutes = "0", seconds = "0"] = DURATION.exec(text) ?? []

  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}

export const parseVideo = (args: string): Video | null => {
  const url = args.trim().split(/\s+/u)[0] ?? ""
  const youtube = YOUTUBE.exec(url)

  if (youtube !== null) {
    const start = YOUTUBE_START.exec(url)?.[1]

    return {
      _tag: "YouTube",
      id: youtube[1] ?? "",
      start: start === undefined ? 0 : durationSeconds(start),
    }
  }

  const vimeo = VIMEO.exec(url)

  if (vimeo !== null) {
    return {
      _tag: "Vimeo",
      id: vimeo[1] ?? "",
      hash: vimeo[2] ?? VIMEO_HASH.exec(url)?.[1] ?? null,
    }
  }

  return FILE.test(url) ? { _tag: "File", url } : null
}

export const parseTimestamp = (args: string): number | null => {
  const text = args.trim()

  if (/^\d+$/u.test(text)) {
    return Number(text)
  }

  const clock = CLOCK.exec(text)

  if (clock === null) {
    return null
  }

  const [, hours = "0", minutes = "0", seconds = "0"] = clock

  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
}
