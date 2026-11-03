import { use, type ReactNode } from "react"
import { IconFile, IconMusic } from "@tabler/icons-react"
import { logseq } from "@seqno/dom"
import { assetKind, isLocalAsset, type AssetKind } from "@seqno/syntax"
import { AssetActions, RenderContext } from "./render.ts"
import { VideoFile } from "./Video.tsx"

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

const remoteUrl = /^(?:https?:|blob:)/i

const fileName = (url: string) => {
  const last = url.split("/").at(-1) ?? url
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

const Missing = ({ url, label, icon }: { url: string; label: string; icon: ReactNode }) => (
  <span className="seqno-image is-missing" title={url}>
    {icon}
    {label === "" ? url : label}
  </span>
)

const useSource = (url: string) => {
  const renderer = use(RenderContext)
  return renderer.resolveAsset(url) ?? (remoteUrl.test(url) ? url : undefined)
}

export const AssetFileLink = ({ url, children }: { url: string; children: ReactNode }) => {
  const source = useSource(url)
  if (source === undefined) {
    return (
      <span {...logseq("seqno-asset", { kind: "doc", url })} data-missing title={url}>
        {children}
      </span>
    )
  }
  return (
    <a
      {...logseq("seqno-asset", { kind: "doc", url })}
      data-kind="file"
      href={source}
      download={fileName(url)}
      onClick={stop}
    >
      {children}
    </a>
  )
}

const PdfLink = ({ url, label }: { url: string; label: string }) => {
  const { openPdf } = use(AssetActions)
  let shown = label
  try {
    shown = decodeURI(label)
  } catch {
    shown = label
  }
  return (
    <a
      role="link"
      tabIndex={0}
      {...logseq("seqno-asset", { kind: "pdf", url })}
      data-kind="pdf"
      draggable
      onDragStart={(event) => event.dataTransfer.setData("file", url)}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openPdf(url)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") openPdf(url)
      }}
    >
      {shown}
    </a>
  )
}

const AudioFile = ({ url, label }: { url: string; label: string }) => {
  const source = useSource(url)
  return source === undefined ? (
    <Missing url={url} label={label} icon={<IconMusic size={16} stroke={1.5} aria-hidden />} />
  ) : (
    <audio
      className="seqno-audio"
      src={source}
      controls
      preload="metadata"
      onClick={stop}
      onPointerDown={stop}
    />
  )
}

export const mediaKind = (url: string): AssetKind => {
  const kind = assetKind(url)
  return kind === "File" && !isLocalAsset(url) ? "Image" : kind
}

export const AssetMedia = ({
  url,
  label,
  image,
}: {
  url: string
  label: string
  image: ReactNode
}): ReactNode => {
  switch (mediaKind(url)) {
    case "Image":
      return image
    case "Pdf":
      return <PdfLink url={url} label={label} />
    case "Audio":
      return <AudioFile url={url} label={label} />
    case "Video":
      return (
        <span {...logseq("seqno-asset-video", { ext: url.split(".").at(-1)?.toLowerCase() ?? "" })}>
          <VideoFile url={url} />
        </span>
      )
    case "Text":
    case "File":
      return (
        <AssetFileLink url={url}>
          <IconFile size={14} stroke={1.75} aria-hidden />
          {label === "" ? fileName(url) : label}
        </AssetFileLink>
      )
  }
}
