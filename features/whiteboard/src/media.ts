import type { Vec } from "@seqno/domain"
import type { Draft } from "./commands.ts"
import { packed } from "./arrange.ts"
import { freshId } from "./ids.ts"

export type Media = "image" | "video" | "pdf"

const EXTENSIONS: ReadonlyArray<readonly [Media, readonly string[]]> = [
  ["image", [".png", ".svg", ".jpg", ".jpeg", ".gif"]],
  ["video", [".mp4", ".webm", ".ogg"]],
  ["pdf", [".pdf"]],
]

export const mediaOf = (name: string): Media | null => {
  const extension = /\.[0-9a-z]+$/i.exec(name)?.[0].toLowerCase()

  if (extension === undefined) {
    return null
  }

  return EXTENSIONS.find(([, extensions]) => extensions.includes(extension))?.[0] ?? null
}

export const PDF_SIZE: Vec = [595, 842]

export const naturalSize = async (url: string, media: Media): Promise<Vec | null> =>
  await new Promise((resolve) => {
    if (media === "pdf") {
      resolve(PDF_SIZE)

      return
    }

    if (media === "video") {
      const video = document.createElement("video")
      video.addEventListener("loadedmetadata", () => {
        resolve([video.videoWidth, video.videoHeight])
      })
      video.addEventListener("error", () => {
        resolve(null)
      })
      video.src = url

      return
    }

    const image = new Image()
    image.addEventListener("load", () => {
      resolve([image.width, image.height])
    })
    image.addEventListener("error", () => {
      resolve(null)
    })
    image.src = url
  })

export interface Saved {
  readonly media: Media
  readonly path: string
  readonly size: Vec | null
}

const defaults = (media: Media) => {
  switch (media) {
    case "image": {
      return { clipping: 0, objectFit: "fill", isAspectRatioLocked: true }
    }

    case "video": {
      return { clipping: 0, isAspectRatioLocked: true }
    }

    case "pdf": {
      return {}
    }
  }
}

export const mediaDrafts = (saved: readonly Saved[], at: Vec): readonly Draft[] => {
  const boxes = saved.map(({ media, path, size }, index) => {
    const point: Vec =
      size === null ? at : [at[0] - size[0] / 4 + index * 16, at[1] - size[1] / 4 + index * 16]

    const shown: Vec = size === null ? [100, 100] : [size[0] / 2, size[1] / 2]

    return { id: freshId(), media, path, point, size: shown }
  })

  const spots = packed(
    boxes.map(({ id, point, size }) => ({
      id,
      bounds: {
        minX: point[0],
        minY: point[1],
        maxX: point[0] + size[0],
        maxY: point[1] + size[1],
      },
    })),
  )

  return boxes.map(({ id, media, path, point, size }) => {
    const [x, y] = spots.get(id) ?? point

    return {
      id,
      text: "",
      raw: {
        type: media,
        point: [x, y],
        size,
        opacity: 1,
        assetId: freshId(),
        src: `../${path}`,
        ...defaults(media),
      },
    }
  })
}
