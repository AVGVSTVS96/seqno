import { Option, Schema } from "effect"
import { assetTypeOf, shapeRaw, wordsField, wordsFields, wordsIn } from "@seqno/domain"
import { round, sub } from "./geometry.ts"
import type { Item, Scene } from "./model.ts"
import { isRaw, isText, rawIn } from "./raw.ts"
import type { Field, Raw } from "./raw.ts"

export interface Copied {
  readonly id: string
  readonly raw: Raw
  readonly text: string
}

const decodeTldr = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      shapes: Schema.Array(Schema.JsonObject),
      bindings: Schema.optionalKey(Schema.Record(Schema.String, Schema.JsonObject)),
      assets: Schema.optionalKey(Schema.Array(Schema.JsonObject)),
    }),
  ),
)

export const handlesOf = (value: Field): ReadonlyArray<readonly [string, Raw]> =>
  Object.entries(rawIn(value)).map(([name, handle]) => [name, rawIn(handle)] as const)

const mapHandles = (raw: Raw, each: (name: string, handle: Raw) => Raw): Raw => {
  const handles = raw["handles"]

  return isRaw(handles)
    ? {
        ...raw,
        handles: Object.fromEntries(
          Object.entries(handles).map(([name, handle]) => [name, each(name, rawIn(handle))]),
        ),
      }
    : raw
}

export const copiedOf = (scene: Scene, items: readonly Item[]): readonly Copied[] =>
  items.map((item) => {
    const raw = shapeRaw(item.block)
    const ends = scene.ends.get(item.block.id)

    if (item.shape.type !== "line" || ends === undefined) {
      return { id: item.block.id, raw, text: item.block.text }
    }

    const origin = item.shape.point

    const drawn = new Map([
      ["start", ends[0]],
      ["end", ends[1]],
    ])

    return {
      id: item.block.id,
      raw: mapHandles(raw, (name, handle) => {
        const at = drawn.get(name)

        if (at === undefined) {
          return handle
        }

        const [x, y] = sub(at, origin)

        return { ...handle, point: [round(x), round(y)] }
      }),
      text: item.block.text,
    }
  })

const TLDR = /<whiteboard-tldr>(.*)<\/whiteboard-tldr>/su

const ENCODED = /%3Cwhiteboard-tldr%3E(.*?)%3C%2Fwhiteboard-tldr%3E/isu

const decodeUri = Option.liftThrowable(decodeURIComponent)

export const clipboardHtml = (copied: readonly Copied[]): string => {
  const bindings = copied.flatMap(({ id, raw }) =>
    Object.entries(rawIn(raw["handles"])).flatMap(([name, handle]) => {
      const toId = rawIn(handle)["bindTo"]

      if (!isText(toId)) {
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

  const assets = copied.flatMap(({ id, raw }) => {
    const src = raw["src"]
    const assetId = raw["assetId"]

    return isText(src)
      ? [
          {
            id: isText(assetId) ? assetId : `${id}-asset`,
            type: assetTypeOf(raw["type"]),
            src,
            size: raw["size"] ?? [0, 0],
          },
        ]
      : []
  })

  const shapes = copied.map(({ id, raw, text }) => {
    const { src: _src, ...rest } = mapHandles(
      raw,
      (name, { bindTo, bindingId: _bindingId, ...handle }) =>
        isText(bindTo)
          ? { id: name, canBind: true, ...handle, bindingId: `${id}-${name}` }
          : { id: name, canBind: true, ...handle },
    )

    const asset = assets.find((item) => item.src === raw["src"])

    const shape = { ...rest, id, ...wordsFields(raw["type"], text) }

    return asset === undefined ? shape : { ...shape, assetId: asset.id }
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

        if (!isText(id)) {
          return []
        }

        const field = wordsField(shape["type"])
        const { [field ?? ""]: _words, ...rest } = shape

        const raw = mapHandles(rest, (_name, { bindingId, ...handle }) => {
          const toId = isText(bindingId) ? bindings[bindingId]?.["toId"] : undefined

          return isText(toId) ? { ...handle, bindTo: toId } : handle
        })

        const src = assets.find((asset) => asset["id"] === shape["assetId"])?.["src"]

        return [
          {
            id,
            raw: isText(src) && raw["src"] === undefined ? { ...raw, src } : raw,
            text: wordsIn(shape),
          },
        ]
      }),
  })
}
