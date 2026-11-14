import { inView } from "motion"
import { reduced } from "./reveal.ts"

const files = import.meta.glob<string>("./media/*", {
  eager: true,
  import: "default",
  query: "?url",
})

const dark = "(prefers-color-scheme: dark)"
export const narrow = "(max-width: 600px)"
const themes = ["dark", "light"] as const
const images = ["avif", "webp"] as const

function variants(name: string, theme: string, ext: string) {
  const pattern = new RegExp(`/${name}-${theme}-(\\d+)\\.${ext}$`, "u")

  return Object.entries(files)
    .flatMap(([path, url]) => {
      const width = pattern.exec(path)?.[1]

      return width === undefined ? [] : [{ url, width: Number(width) }]
    })
    .toSorted((a, b) => a.width - b.width)
}

const srcset = (name: string, theme: string, ext: string) =>
  variants(name, theme, ext)
    .map(({ url, width }) => `${url} ${width}w`)
    .join(", ")

const file = (name: string) => {
  const url = Object.entries(files).find(([path]) => path.endsWith(`/${name}`))?.[1]

  if (url === undefined) {
    throw new Error(`missing media ${name}`)
  }

  return url
}

interface PictureProps {
  readonly name: string
  readonly alt: string
  readonly width: number
  readonly height: number
  readonly sizes: string
  readonly className?: string
  readonly phone?: readonly [width: number, height: number]
}

const looks = (name: string, phone: PictureProps["phone"]) => [
  ...(phone ? [{ name: `${name}-phone`, media: narrow, size: phone }] : []),
  { name, media: undefined, size: undefined },
]

const query = (...parts: ReadonlyArray<string | undefined>) =>
  parts.filter((part) => part !== undefined).join(" and ") || undefined

export function Picture({ name, alt, width, height, sizes, className, phone }: PictureProps) {
  const fallback = variants(name, "light", "webp").at(-1)?.url

  return (
    <picture className={className}>
      {looks(name, phone).flatMap((look) =>
        themes.flatMap((theme) =>
          images.map((ext) => (
            <source
              key={`${look.name}-${theme}-${ext}`}
              media={query(look.media, theme === "dark" ? dark : undefined)}
              type={`image/${ext}`}
              srcSet={srcset(look.name, theme, ext)}
              sizes={sizes}
              width={look.size?.[0]}
              height={look.size?.[1]}
            />
          )),
        ),
      )}
      <img src={fallback} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </picture>
  )
}

function playInView(video: HTMLVideoElement | null) {
  if (!video || reduced()) {
    return
  }

  const stop = inView(
    video,
    () => {
      video.play().catch(() => {})

      return () => {
        video.pause()
      }
    },
    { amount: 0.6 },
  )

  video.addEventListener("ended", stop, { once: true })

  return stop
}

export function Loop(props: PictureProps) {
  return (
    <div className="loop">
      <Picture {...props} />
      <video
        ref={playInView}
        muted
        playsInline
        preload="none"
        aria-hidden="true"
        width={props.width}
        height={props.height}
        onPlaying={(event) => {
          event.currentTarget.dataset.playing = ""
        }}
        onPause={(event) => {
          delete event.currentTarget.dataset.playing
        }}
      >
        {looks(props.name, props.phone).flatMap((look) =>
          themes.flatMap((theme) => {
            const media = query(look.media, theme === "dark" ? dark : undefined)

            return [
              <source
                key={`${look.name}-${theme}-webm`}
                media={media}
                src={file(`${look.name}-${theme}.webm`)}
                type='video/webm; codecs="av01.0.08M.08"'
              />,
              <source
                key={`${look.name}-${theme}-mp4`}
                media={media}
                src={file(`${look.name}-${theme}.mp4`)}
                type="video/mp4"
              />,
            ]
          }),
        )}
      </video>
    </div>
  )
}
