import { Option } from "effect"

export type FileNameFormat = "triple-lowbar" | "legacy"

const encodedChar = /%[0-9a-f]{2}/gi
const reservedRun = /[:*?"<>|#\\]+/g
const legacyAndroidRun = /[\\#|%]+/g
const legacyReservedRun = /[:\\*?"<>|]+/g
const windowsReserved = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`COM${n}`, `LPT${n}`]),
])

const decode = (text: string) =>
  Option.getOrElse(Option.liftThrowable(decodeURIComponent)(text), () => text)

const withoutBoundarySlashes = (title: string) =>
  title.replace(/^\//, "").replace(/\/$/, "").normalize("NFC")

const uriEncode = (run: string) => encodeURIComponent(run).replaceAll("*", "%2A")

const tripleLowbarBody = (title: string) => {
  const escaped = withoutBoundarySlashes(title)
    .replace(encodedChar, (code) => code.replace("%", "%25"))
    .replace(reservedRun, uriEncode)
    .replace(/^\./, "%2E")
  const guarded = windowsReserved.has(escaped) || escaped.endsWith(".") ? `${escaped}/` : escaped
  return guarded
    .replaceAll("___", "%5F%5F%5F")
    .replaceAll("_/", "%5F/")
    .replaceAll("/_", "/%5F")
    .replaceAll("/", "___")
}

const legacyBody = (title: string) =>
  withoutBoundarySlashes(title)
    .replace(legacyAndroidRun, encodeURIComponent)
    .replace(legacyReservedRun, encodeURIComponent)
    .replaceAll("/", "%2F")
    .replaceAll("*", "%2A")

export const fileBodyFromTitle = (title: string, format: FileNameFormat): string =>
  format === "triple-lowbar" ? tripleLowbarBody(title) : legacyBody(title)

export const titleFromFileBody = (body: string, format: FileNameFormat): string => {
  const nfc = body.normalize("NFC")
  return format === "triple-lowbar"
    ? nfc
        .replaceAll("___", "/")
        .replace(encodedChar, decode)
        .split("/")
        .filter((part) => part !== "")
        .join("/")
    : decode(nfc.replaceAll(".", "/"))
}

export const needsTitleProperty = (title: string, format: FileNameFormat): boolean =>
  titleFromFileBody(fileBodyFromTitle(title, format), format) !== title
