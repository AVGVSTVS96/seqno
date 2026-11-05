import { inView } from "motion"
import { reduced } from "./reveal.ts"

const files = import.meta.glob<string>("./media/*", {
  eager: true,
  import: "default",
  query: "?url",
})
const dark = "(prefers-color-scheme: dark)"
const themes = ["dark", "light"] as const
const images = ["avif", "webp"] as const

function variants(name: string, theme: string, ext: string) {
  const pattern = new RegExp(`/${name}-${theme}-(\\d+)\\.${ext}$`)
  return Object.entries(files)
    .flatMap(([path, url]) => {
      const width = pattern.exec(path)?.[1]
      return width ? [{ url, width: Number(width) }] : []
    })
    .sort((a, b) => a.width - b.width)
}

const srcset = (name: string, theme: string, ext: string) =>
  variants(name, theme, ext)
    .map(({ url, width }) => `${url} ${width}w`)
    .join(", ")

const file = (name: string) => {
  const url = Object.entries(files).find(([path]) => path.endsWith(`/${name}`))?.[1]
  if (!url) throw new Error(`missing media ${name}`)
  return url
}

interface PictureProps {
  readonly name: string
  readonly alt: string
  readonly width: number
  readonly height: number
  readonly sizes: string
  readonly className?: string
}

export function Picture({ name, alt, width, height, sizes, className }: PictureProps) {
  const fallback = variants(name, "light", "webp").at(-1)?.url
  return (
    <picture className={className}>
      {themes.flatMap((theme) =>
        images.map((ext) => (
          <source
            key={`${theme}-${ext}`}
            media={theme === "dark" ? dark : undefined}
            type={`image/${ext}`}
            srcSet={srcset(name, theme, ext)}
            sizes={sizes}
          />
        )),
      )}
      <img src={fallback} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </picture>
  )
}

function playInView(video: HTMLVideoElement | null) {
  if (!video || reduced()) return
  return inView(
    video,
    () => {
      if (video.ended) video.currentTime = 0
      video.play().catch(() => {})
      return () => video.pause()
    },
    { amount: 0.6 },
  )
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
        onPlaying={(event) => (event.currentTarget.dataset.playing = "")}
      >
        {themes.flatMap((theme) => [
          <source
            key={`${theme}-webm`}
            media={theme === "dark" ? dark : undefined}
            src={file(`${props.name}-${theme}.webm`)}
            type='video/webm; codecs="av01.0.08M.08"'
          />,
          <source
            key={`${theme}-mp4`}
            media={theme === "dark" ? dark : undefined}
            src={file(`${props.name}-${theme}.mp4`)}
            type="video/mp4"
          />,
        ])}
      </video>
    </div>
  )
}
