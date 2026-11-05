import { Option, Schema } from "effect"
import { assetTypeOf, shapeRaw, wordsField, wordsFields, wordsIn } from "@seqno/domain"
import type { Vec } from "@seqno/domain"
import { round, sub } from "./geometry.ts"
import type { Item, Scene } from "./model.ts"

type Raw = Readonly<Record<string, unknown>>

export interface Copied {
  readonly id: string
  readonly raw: Raw
  readonly text: string
}

const RawRecord = Schema.Record(Schema.String, Schema.Unknown)

const decodeRecord = Schema.decodeUnknownOption(RawRecord)

const decodeTldr = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      shapes: Schema.Array(RawRecord),
      bindings: Schema.optionalKey(Schema.Record(Schema.String, RawRecord)),
      assets: Schema.optionalKey(Schema.Array(RawRecord)),
    }),
  ),
)

const recordOf = (value: unknown): Raw => Option.getOrElse(decodeRecord(value), () => ({}))

export const handlesOf = (value: unknown): ReadonlyArray<readonly [string, Raw]> =>
  Object.entries(recordOf(value)).map(([name, handle]) => [name, recordOf(handle)] as const)

const mapHandles = (raw: Raw, each: (name: string, handle: Raw) => Raw): Raw => {
  const handles = decodeRecord(raw["handles"])

  return Option.isNone(handles)
    ? raw
    : {
        ...raw,
        handles: Object.fromEntries(
          Object.entries(handles.value).map(([name, handle]) => [
            name,
            each(name, recordOf(handle)),
          ]),
        ),
      }
}

export const copiedOf = (scene: Scene, items: readonly Item[]): readonly Copied[] =>
  items.map((item) => {
    const raw = shapeRaw(item.block)
    const ends = scene.ends.get(item.block.id)

    if (item.shape.type !== "line" || ends === undefined) {
      return { id: item.block.id, raw, text: item.block.text }
    }

    const origin = item.shape.point

    const drawn = (name: string): Vec | undefined =>
      name === "start" ? ends[0] : name === "end" ? ends[1] : undefined

    return {
      id: item.block.id,
      raw: mapHandles(raw, (name, handle) => {
        const at = drawn(name)

        if (at === undefined) {
          return handle
        }

        const [x, y] = sub(at, origin)

        return { ...handle, point: [round(x), round(y)] }
      }),
      text: item.block.text,
    }
  })

const TLDR = /<whiteboard-tldr>(.*)<\/whiteboard-tldr>/s

const ENCODED = /%3Cwhiteboard-tldr%3E(.*?)%3C%2Fwhiteboard-tldr%3E/is

const decodeUri = Option.liftThrowable(decodeURIComponent)

export const clipboardHtml = (copied: readonly Copied[]): string => {
  const bindings = copied.flatMap(({ id, raw }) =>
    Object.entries(recordOf(raw["handles"])).flatMap(([name, handle]) => {
      const toId = recordOf(handle)["bindTo"]

      if (typeof toId !== "string") {
        return []
      }

      const bindingId = `${id}-${name}`

      return [
        [
          bindingId,
          {
            id: bindingId,
            type: "line",
            fromId: id,
            toId,
            handleId: name,
            point: [0.5, 0.5],
            distance: 4,
          },
        ] as const,
      ]
    }),
  )

  const assets = copied.flatMap(({ id, raw }) =>
    typeof raw["src"] === "string"
      ? [
          {
            id: typeof raw["assetId"] === "string" ? raw["assetId"] : `${id}-asset`,
            type: assetTypeOf(raw["type"]),
            src: raw["src"],
            size: raw["size"] ?? [0, 0],
          },
        ]
      : [],
  )

  const shapes = copied.map(({ id, raw, text }) => {
    const { src: _src, ...rest } = mapHandles(
      raw,
      (name, { bindTo, bindingId: _bindingId, ...handle }) =>
        typeof bindTo === "string"
          ? { id: name, canBind: true, ...handle, bindingId: `${id}-${name}` }
          : { id: name, canBind: true, ...handle },
    )

    const asset = assets.find((item) => item.src === raw["src"])

    return {
      ...rest,
      id,
      ...wordsFields(raw["type"], text),
      ...(asset === undefined ? {} : { assetId: asset.id }),
    }
  })

  const json = JSON.stringify({ shapes, assets, bindings: Object.fromEntries(bindings) })

  return encodeURIComponent(`<whiteboard-tldr>${json}</whiteboard-tldr>`)
}

const tldrIn = (html: string): string | undefined => {
  const encoded = ENCODED.exec(html)?.[1]

  if (encoded !== undefined) {
    return Option.getOrUndefined(decodeUri(encoded))
  }

  return TLDR.exec(Option.getOrElse(decodeUri(html), () => html))?.[1]
}

export const readClipboard = (html: string): readonly Copied[] => {
  const inner = tldrIn(html)

  if (inner === undefined) {
    return []
  }

  return Option.match(decodeTldr(inner), {
    onNone: () => [],
    onSome: ({ shapes, bindings = {}, assets = [] }) =>
      shapes.flatMap((shape) => {
        const id = shape["id"]

        if (typeof id !== "string") {
          return []
        }

        const field = wordsField(shape["type"])
        const { [field ?? ""]: _words, ...rest } = shape

        const raw = mapHandles(rest, (_name, { bindingId, ...handle }) => {
          const toId = typeof bindingId === "string" ? bindings[bindingId]?.["toId"] : undefined

          return typeof toId === "string" ? { ...handle, bindTo: toId } : handle
        })

        const src = assets.find((asset) => asset["id"] === shape["assetId"])?.["src"]

        return [
          {
            id,
            raw: typeof src === "string" && raw["src"] === undefined ? { ...raw, src } : raw,
            text: wordsIn(shape),
          },
        ]
      }),
  })
}
