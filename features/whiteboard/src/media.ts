import type { Vec } from "@seqno/domain"
import type { Draft } from "./commands.ts"
import { round } from "./geometry.ts"
import { freshId } from "./ids.ts"

export type Media = "image" | "video" | "pdf"

const EXTENSIONS: ReadonlyArray<readonly [Media, ReadonlyArray<string>]> = [
  ["image", [".png", ".svg", ".jpg", ".jpeg", ".gif"]],
  ["video", [".mp4", ".webm", ".ogg"]],
  ["pdf", [".pdf"]],
]

export const mediaOf = (name: string): Media | null => {
  const extension = /\.[0-9a-z]+$/i.exec(name)?.[0].toLowerCase()
  if (extension === undefined) return null
  return EXTENSIONS.find(([, extensions]) => extensions.includes(extension))?.[0] ?? null
}

export const PDF_SIZE: Vec = [595, 842]

export const naturalSize = (url: string, media: Media): Promise<Vec | null> =>
  new Promise((resolve) => {
    if (media === "pdf") {
      resolve(PDF_SIZE)
      return
    }
    if (media === "video") {
      const video = document.createElement("video")
      video.addEventListener("loadedmetadata", () => resolve([video.videoWidth, video.videoHeight]))
      video.addEventListener("error", () => resolve(null))
      video.src = url
      return
    }
    const image = new Image()
    image.addEventListener("load", () => resolve([image.width, image.height]))
    image.addEventListener("error", () => resolve(null))
    image.src = url
  })

export interface Saved {
  readonly media: Media
  readonly path: string
  readonly size: Vec | null
}

const defaults = (media: Media) => {
  switch (media) {
    case "image":
      return { clipping: 0, objectFit: "fill", isAspectRatioLocked: true }
    case "video":
      return { clipping: 0, isAspectRatioLocked: true }
    case "pdf":
      return {}
  }
}

export const mediaDrafts = (saved: ReadonlyArray<Saved>, at: Vec): ReadonlyArray<Draft> =>
  saved.map(({ media, path, size }, index) => {
    const placed =
      size === null
        ? { point: [round(at[0]), round(at[1])], size: [100, 100] }
        : {
            point: [
              round(at[0] - size[0] / 4 + index * 16),
              round(at[1] - size[1] / 4 + index * 16),
            ],
            size: [round(size[0] / 2), round(size[1] / 2)],
          }
    return {
      text: "",
      raw: {
        type: media,
        ...placed,
        opacity: 1,
        assetId: freshId(),
        src: `../${path}`,
        ...defaults(media),
      },
    }
  })
