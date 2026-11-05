import type { Dialect } from "./inline.ts"

export const assetsFolder = "assets"

const set = (words: string) => new Set(words.split(" "))

const editorImages = set("png jpg jpeg bmp gif webp svg heic")
const audioFormats = set("mp3 ogg mpeg wav m4a flac wma aac")
const html5Audio = set("mp3 mpeg wav m4a flac aac")
const html5Video = set("mp4 webm mov flv avi")
const playableVideo = set("mp4 webm mov")
const docFormats = set("doc docx xls xlsx ppt pptx one pdf epub")
const markupFormats = set("org md markdown asciidoc adoc rst")
const renderedImages = set("gif svg jpeg ico png jpg bmp webp")

const textFormats = set(
  "json org md yml dat asciidoc rst txt markdown adoc html js ts edn clj ml rb ex erl java php c css excalidraw tldr sh",
)

const supported = [
  editorImages,
  docFormats,
  audioFormats,
  set("mp4 webm mov flv avi mkv"),
  markupFormats,
  textFormats,
]

export const assetKey = (link: string): string => {
  let path = link

  try {
    path = decodeURI(link)
  } catch {
    path = link
  }

  return path.replace(/^(?:\.{1,2}\/|\/)+/u, "").normalize("NFC")
}

export const assetPathOf = (link: string): string | null => {
  const parts = assetKey(link)
    .split("/")
    .filter((part) => part !== "" && part !== ".")

  return parts[0] === assetsFolder && parts.length > 1 && !parts.includes("..")
    ? parts.join("/")
    : null
}

export const isLocalAsset = (link: string) => /^[./]*assets\//u.test(link)

export const extensionOf = (path: string): string =>
  /\.(\w+)[^.]*$/u.exec(path)?.[1]?.toLowerCase() ?? ""

export type AssetKind = "Image" | "Pdf" | "Audio" | "Video" | "Text" | "File"

export const assetKind = (path: string): AssetKind => {
  const ext = extensionOf(path)

  if (ext === "pdf") {
    return "Pdf"
  }

  if (audioFormats.has(ext)) {
    return "Audio"
  }

  if (playableVideo.has(ext)) {
    return "Video"
  }

  if (renderedImages.has(ext)) {
    return "Image"
  }

  if (textFormats.has(ext)) {
    return "Text"
  }

  return "File"
}

const completeExtension = (name: string) => {
  const dot = name.indexOf(".", 1)

  return dot === -1 ? "" : name.slice(dot)
}

const lastExtension = (name: string) => {
  const dot = name.lastIndexOf(".")

  return dot <= 0 ? "" : name.slice(dot)
}

export const assetFileName = (original: string, now: number, index: number): string => {
  const name = original.replaceAll("\\", "/").split("/").at(-1) ?? original
  const last = lastExtension(name)
  const lower = last.slice(1).toLowerCase()
  const ext = supported.some((formats) => formats.has(lower)) ? last : completeExtension(name)
  const stem = name.slice(0, name.length - ext.length).replaceAll(/[ %/]/gu, "_")

  return `${`${stem}_${now}_${index}`.replaceAll(/_+/gu, "_")}${ext}`
}

export const assetLink = (label: string, path: string, dialect: Dialect = "markdown"): string => {
  const ext = extensionOf(path)

  if (dialect === "org") {
    return editorImages.has(ext) ? `[[../${path}]]` : `[[../${path}][${label}]]`
  }

  const shown = editorImages.has(ext) || ext === "pdf" || html5Audio.has(ext) || html5Video.has(ext)

  return `${shown ? "!" : ""}[${label}](../${path})`
}

const concatWithoutSpaces = (left: string, right: string) => {
  const trimmed = left.replace(/[ \t\r]+$/u, "")
  const gap = trimmed.trim() === "" || trimmed.endsWith("\n") ? "" : " "

  return `${trimmed}${gap}${right.replace(/^[ \t\r]+/u, "")}`
}

export const insertAsset = (text: string, from: number, to: number, link: string) => {
  const prefix = concatWithoutSpaces(text.slice(0, from), link)
  const after = text.slice(to)

  return {
    text: after.trim() === "" ? prefix : concatWithoutSpaces(prefix, after),
    caret: prefix.length,
  }
}

export const hlsPagePrefix = "hls__"

export const assetPageName = (name: string): string => {
  if (name.trim() === "") {
    return name
  }

  const localAsset = /[0-9]{13}_\d$/u.test(name)

  if (!localAsset && !name.startsWith(hlsPagePrefix)) {
    return name
  }

  return (localAsset ? name.slice(0, -15) : name)
    .replace(/^hls__/u, "")
    .replace(/__[-\d]+$/u, "")
    .replaceAll("_", " ")
    .trimEnd()
}
