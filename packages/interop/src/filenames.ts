import { Option } from "effect"

export type FileNameFormat = "triple-lowbar" | "legacy"

const reservedChar = /[:*?"<>|#\\]/g
const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const percentBeforeHex = /%(?=[0-9a-f]{2})/gi
const escapeRun = /(?:%[0-9a-f]{2})+/gi

const percentEncode = (char: string): string =>
  `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`

const decodeComponent = Option.liftThrowable(decodeURIComponent)

const percentDecode = (text: string): string =>
  text.replace(escapeRun, (run) => Option.getOrElse(decodeComponent(run), () => run))

const needsGuard = (body: string): boolean => windowsReserved.test(body) || body.endsWith(".")

export const fileBodyFromTitle = (title: string): string => {
  const escaped = title
    .normalize("NFC")
    .replace(percentBeforeHex, "%25")
    .replace(reservedChar, percentEncode)
    .replace(/^\./, "%2E")
    .replace(/_(?=\/)/g, "%5F")
  const guarded = needsGuard(escaped) ? `${escaped}/` : escaped
  return guarded.replaceAll("___", "%5F%5F%5F").replaceAll("/", "___")
}

const unguard = (title: string): string =>
  title.endsWith("/") && needsGuard(title.slice(0, -1)) ? title.slice(0, -1) : title

export const titleFromFileBody = (body: string, format: FileNameFormat): string => {
  const nfc = body.normalize("NFC")
  return format === "triple-lowbar"
    ? unguard(percentDecode(nfc.replaceAll("___", "/"))).normalize("NFC")
    : percentDecode(nfc.replaceAll(".", "/")).normalize("NFC")
}
