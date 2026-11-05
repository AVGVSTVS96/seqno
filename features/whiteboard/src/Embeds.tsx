import { IconBrandYoutube } from "@tabler/icons-react"
import { Option, Schema } from "effect"
import { useState } from "react"

export const YOUTUBE_REGEX =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})(?:\S+)?$/

export const TWITTER_REGEX = /https?:\/\/twitter.com\/[0-9a-zA-Z_]{1,20}\/status\/([0-9]*)/

export const isWebUrl = (text: string) => {
  try {
    const url = new URL(text)

    return url.host !== "" && (url.protocol === "http:" || url.protocol === "https:")
  } catch {
    return false
  }
}

export type UrlEmbed = "youtube" | "tweet" | "iframe"

export const embedOf = (url: string): UrlEmbed =>
  YOUTUBE_REGEX.test(url) ? "youtube" : TWITTER_REGEX.test(url) ? "tweet" : "iframe"

export const EMBED_SIZE: Record<UrlEmbed | "html", readonly [number, number]> = {
  youtube: [853, 480],
  tweet: [331, 290],
  iframe: [853, 480],
  html: [600, 0],
}

export const YOUTUBE_RATIO = 480 / 853

const playerSandbox =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"

const siteSandbox = "allow-scripts allow-same-origin allow-presentation"

const youtubeId = (url: string) => YOUTUBE_REGEX.exec(url)?.[1] ?? url

const tweetId = (url: string) => TWITTER_REGEX.exec(url)?.[1] ?? url

export const YouTubeView = ({ url, still }: { readonly url: string; readonly still: boolean }) => {
  const id = youtubeId(url)

  return (
    <div
      className="wb-youtube"
      style={{
        background: `url('https://img.youtube.com/vi/${id}/mqdefault.jpg') no-repeat center/cover`,
      }}
    >
      {still ? null : id === "" ? (
        <div className="wb-youtube-empty">
          <IconBrandYoutube size={128} stroke={1} aria-label="YouTube" />
        </div>
      ) : (
        <iframe
          className="wb-frame"
          width="853"
          height="480"
          src={`https://www.youtube.com/embed/${id}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          sandbox={playerSandbox}
          title="Embedded youtube"
        />
      )}
    </div>
  )
}

const TWITTER_ORIGIN = "https://platform.twitter.com"

const Resize = Schema.Struct({
  "twttr.embed": Schema.Struct({
    method: Schema.Literal("twttr.private.resize"),
    params: Schema.Array(Schema.Struct({ height: Schema.Finite })),
  }),
})

const decodeResize = Schema.decodeUnknownOption(Resize)
const decodeResizeText = Schema.decodeUnknownOption(Schema.fromJsonString(Resize))

const heightIn = (data: unknown): number | null => {
  const resize = typeof data === "string" ? decodeResizeText(data) : decodeResize(data)

  return Option.match(resize, {
    onNone: () => null,
    onSome: (message) => message["twttr.embed"].params[0]?.height ?? null,
  })
}

export const TweetView = ({
  url,
  dark,
  measure,
}: {
  readonly url: string
  readonly dark: boolean
  readonly measure: (node: HTMLElement | null) => (() => void) | undefined
}) => {
  const id = tweetId(url)
  const [height, setHeight] = useState<number | null>(null)

  const [frame] = useState(() => (node: HTMLIFrameElement | null) => {
    if (node === null) {
      return
    }

    const listen = (event: MessageEvent) => {
      if (event.origin !== TWITTER_ORIGIN || event.source !== node.contentWindow) {
        return
      }

      const next = heightIn(event.data)

      if (next !== null) {
        setHeight(next)
      }
    }

    window.addEventListener("message", listen)

    return () => {
      window.removeEventListener("message", listen)
    }
  })

  return (
    <div className="wb-tweet">
      {id === "" ? null : (
        <div ref={measure}>
          {height === null ? <span className="wb-tweet-loading">... loading</span> : null}
          <iframe
            ref={frame}
            className="wb-tweet-frame"
            title="Embedded tweet"
            sandbox={playerSandbox}
            src={`${TWITTER_ORIGIN}/embed/Tweet.html?dnt=true&id=${encodeURIComponent(id)}${dark ? "&theme=dark" : ""}`}
            style={{ height: height ?? 0 }}
          />
        </div>
      )}
    </div>
  )
}

export const IFrameView = ({
  url,
  frameKey,
}: {
  readonly url: string
  readonly frameKey: number
}) => (
  <div className="wb-iframe">
    {url === "" ? null : (
      <iframe
        key={frameKey}
        className="wb-frame"
        width="100%"
        height="100%"
        src={url}
        sandbox={siteSandbox}
        title="Embedded website"
      />
    )}
  </div>
)

const DROPPED = new Set(["script", "style", "link", "meta", "base", "object", "embed", "noscript"])

export const cleanHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(html.trim(), "text/html")

  for (const element of doc.body.querySelectorAll("*")) {
    if (DROPPED.has(element.localName)) {
      element.remove()
      continue
    }

    for (const name of element.getAttributeNames()) {
      const value = (element.getAttribute(name) ?? "").trim().toLowerCase()

      if (name.startsWith("on") || value.startsWith("javascript:")) {
        element.removeAttribute(name)
      }
    }
  }

  return doc.body.innerHTML
}

export const HtmlView = ({
  html,
  scale,
  measure,
}: {
  readonly html: string
  readonly scale: number
  readonly measure: (node: HTMLElement | null) => (() => void) | undefined
}) => (
  <div
    className="wb-html"
    style={{
      width: `calc(100% / ${scale})`,
      height: `calc(100% / ${scale})`,
      transform: `scale(${scale})`,
    }}
  >
    <div
      ref={measure}
      className="wb-html-anchor"
      dangerouslySetInnerHTML={{ __html: cleanHtml(html) }}
    />
  </div>
)

export const PdfView = ({ src }: { readonly src: string | undefined }) =>
  src === undefined ? null : (
    <embed className="wb-pdf" src={src} type="application/pdf" title="PDF" />
  )

const clampHtml = (value: number) => Math.max(Math.min(value === 0 ? 400 : value, 1400), 10)

export const htmlBounds = (measured: readonly [number, number], scale: number) =>
  [clampHtml(measured[0] * scale), clampHtml(measured[1] * scale)] as const
