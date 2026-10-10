import { use, useRef, useState } from "react"
import { Match } from "effect"
import { IconClock, IconMovie, IconPlayerPlayFilled } from "@tabler/icons-react"
import type { Video } from "@seqno/syntax"
import { RenderContext } from "./render.ts"

const seekEvent = "seqno-seek"
const youtubeOrigin = "https://www.youtube-nocookie.com"
const vimeoOrigin = "https://player.vimeo.com"
const playableUrl = /^(?:https?:|blob:)/i

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

const playerSandbox =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"

const seekable = (seek: (seconds: number) => void) => {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === "number") seek(event.detail)
  }
  return (element: HTMLElement | null) => {
    if (element === null) return
    element.addEventListener(seekEvent, listener)
    return () => element.removeEventListener(seekEvent, listener)
  }
}

const YouTube = ({ id, start }: { readonly id: string; readonly start: number }) => {
  const [playingFrom, setPlayingFrom] = useState<number | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const seek = (seconds: number) => {
    const player = frame.current?.contentWindow
    if (playingFrom === null || player === null || player === undefined) {
      setPlayingFrom(seconds)
      return
    }
    const command = (func: string, args: ReadonlyArray<unknown>) =>
      player.postMessage(JSON.stringify({ event: "command", func, args }), youtubeOrigin)
    command("seekTo", [seconds, true])
    command("playVideo", [])
  }
  return (
    <span
      className="seqno-video"
      data-video=""
      ref={seekable(seek)}
      onClick={stop}
      onPointerDown={stop}
    >
      {playingFrom === null ? (
        <button
          type="button"
          className="seqno-video-poster"
          aria-label="Play video"
          onClick={() => setPlayingFrom(start)}
        >
          <img
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            draggable={false}
          />
          <span className="seqno-video-play" aria-hidden>
            <IconPlayerPlayFilled size={22} />
          </span>
        </button>
      ) : (
        <iframe
          ref={frame}
          title="YouTube video"
          src={`${youtubeOrigin}/embed/${id}?autoplay=1&enablejsapi=1&rel=0&start=${playingFrom}`}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox={playerSandbox}
          allowFullScreen
        />
      )}
    </span>
  )
}

const Vimeo = ({ id, hash }: { readonly id: string; readonly hash: string | null }) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const seek = (seconds: number) => {
    const player = frame.current?.contentWindow
    player?.postMessage(JSON.stringify({ method: "setCurrentTime", value: seconds }), vimeoOrigin)
    player?.postMessage(JSON.stringify({ method: "play" }), vimeoOrigin)
  }
  return (
    <span
      className="seqno-video"
      data-video=""
      ref={seekable(seek)}
      onClick={stop}
      onPointerDown={stop}
    >
      <iframe
        ref={frame}
        title="Vimeo video"
        src={`${vimeoOrigin}/video/${id}?${hash === null ? "" : `h=${hash}&`}dnt=1`}
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
        loading="lazy"
        sandbox={playerSandbox}
        allowFullScreen
      />
    </span>
  )
}

const VideoFile = ({ url }: { readonly url: string }) => {
  const renderer = use(RenderContext)
  const player = useRef<HTMLVideoElement>(null)
  const source = renderer.resolveAsset(url) ?? (playableUrl.test(url) ? url : undefined)
  if (source === undefined) {
    return (
      <span className="seqno-image is-missing" title={url}>
        <IconMovie size={16} stroke={1.5} aria-hidden />
        {url}
      </span>
    )
  }
  const seek = (seconds: number) => {
    if (player.current === null) return
    player.current.currentTime = seconds
    void player.current.play().catch(() => undefined)
  }
  return (
    <span
      className="seqno-video is-file"
      data-video=""
      ref={seekable(seek)}
      onClick={stop}
      onPointerDown={stop}
    >
      <video ref={player} src={source} controls preload="metadata" playsInline />
    </span>
  )
}

export const VideoEmbed = ({ video }: { readonly video: Video }) =>
  Match.valueTags(video, {
    YouTube: ({ id, start }) => <YouTube id={id} start={start} />,
    Vimeo: ({ id, hash }) => <Vimeo id={id} hash={hash} />,
    File: ({ url }) => <VideoFile url={url} />,
  })

const seekNearest = (from: HTMLElement, seconds: number) => {
  const page = from.closest("article") ?? from.closest(".seqno-outliner") ?? document
  const videos = [...page.querySelectorAll<HTMLElement>("[data-video]")]
  const before = videos.filter(
    (video) => (video.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  )
  const nearest = before.at(-1) ?? videos[0]
  nearest?.dispatchEvent(new CustomEvent(seekEvent, { detail: seconds }))
}

const pad = (value: number) => String(value).padStart(2, "0")

const clock = (total: number) => {
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export const Timestamp = ({ seconds }: { readonly seconds: number }) => (
  <button
    type="button"
    className="seqno-timestamp"
    title="Play the video from here"
    onPointerDown={stop}
    onClick={(event) => {
      event.stopPropagation()
      seekNearest(event.currentTarget, seconds)
    }}
  >
    <IconClock size={14} stroke={2} aria-hidden />
    {clock(seconds)}
  </button>
)
