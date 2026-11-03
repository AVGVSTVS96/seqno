import datascript, { type Db } from "datascript"
import { blockRefId, normalizePageName, type Block, type Page, type PageId } from "@seqno/domain"
import { propertyValue } from "@seqno/export"
import { analyzeBlock } from "@seqno/syntax"
import { contentOf, numberOf } from "./shapes.ts"

export interface PageFile {
  readonly page: Page
  readonly blocks: ReadonlyArray<Block>
  readonly path: string
}

interface Edn {
  readonly edn: string
}

type Value = string | number | boolean | Edn

type Fact = readonly [number, string, Value]

const schema = `{${[
  ":block/uuid {:db/unique :db.unique/identity}",
  ":block/name {:db/unique :db.unique/identity}",
  ":block/original-name {:db/unique :db.unique/identity}",
  ":file/path {:db/unique :db.unique/identity}",
  ":block/parent {:db/valueType :db.type/ref :db/index true}",
  ":block/left {:db/valueType :db.type/ref :db/index true}",
  ":block/page {:db/valueType :db.type/ref :db/index true}",
  ":block/collapsed? {:db/index true}",
  ":block/refs {:db/valueType :db.type/ref :db/cardinality :db.cardinality/many}",
  ":block/path-refs {:db/valueType :db.type/ref :db/cardinality :db.cardinality/many}",
  ":block/tags {:db/valueType :db.type/ref :db/cardinality :db.cardinality/many}",
  ":block/alias {:db/valueType :db.type/ref :db/cardinality :db.cardinality/many}",
  ":block/namespace {:db/valueType :db.type/ref}",
  ":block/file {:db/valueType :db.type/ref}",
].join(" ")}}`

const tx0 = 536_870_912

export const readEdn = (texts: ReadonlyArray<string>): Array<unknown> =>
  texts.length === 0
    ? []
    : datascript
        .datoms(
          datascript.from_serializable({
            count: texts.length,
            tx0,
            "max-eid": texts.length,
            "max-tx": tx0,
            schema: "{}",
            attrs: ["v"],
            keywords: [],
            eavt: texts.map((text, index) => [index + 1, 0, [1, text], 0] as const),
            aevt: texts.map((_, index) => index),
            avet: [],
          }),
          ":eavt",
        )
        .map((datom) => datom.v)

const edn = (text: string): Edn => ({ edn: text })
const keyword = (name: string) => edn(`:${name}`)
const uuid = (id: string) => edn(`#uuid ${JSON.stringify(id)}`)
const ednText = (value: string | number | boolean) =>
  typeof value === "string" ? JSON.stringify(value) : String(value)

const VALID_KEY = /^[^\s"|^(){}#,:/\\[\]][^\s"|^(){},\\[\]]*$/u
const HEADING = /^(#+)[ \t]/

const derivedUuid = (seed: string) => {
  const half = (salt: string) => {
    let hash = 0xcbf29ce484222325n
    for (const char of salt + seed) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n)
    }
    return hash.toString(16).padStart(16, "0")
  }
  const hex = half("page") + half("name")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const typedProperties = (props: Readonly<Record<string, string>>) =>
  Object.entries(props)
    .filter(([key]) => key !== "id" && VALID_KEY.test(key))
    .map(([key, raw]) => [key, raw, propertyValue(key, raw)] as const)

const ednMap = (entries: ReadonlyArray<readonly [string, string]>) =>
  edn(`{${entries.map(([key, value]) => `:${key} ${value}`).join(" ")}}`)

const typedText = (value: ReturnType<typeof propertyValue>) =>
  typeof value === "object"
    ? `#{${value.map((item) => JSON.stringify(item)).join(" ")}}`
    : ednText(value)

const listed = (value: ReturnType<typeof propertyValue> | undefined) =>
  typeof value === "object" ? value : []

const namespaces = (title: string) => {
  const parts = title.split("/")
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("/"))
}

const makeBuilder = () => {
  const names = new Map<string, number>()
  const blocks = new Map<string, number>()
  const owner = new Map<number, PageId>()
  const facts: Array<Fact> = []

  const pageRef = (title: string): number => {
    const name = normalizePageName(title)
    const known = names.get(name)
    if (known !== undefined) return known
    const id = derivedUuid(name)
    const eid = numberOf(id)
    names.set(name, eid)
    facts.push(
      [eid, "block/uuid", uuid(id)],
      [eid, "block/name", name],
      [eid, "block/original-name", title.trim()],
      [eid, "block/journal?", false],
    )
    const parent = namespaces(title.trim()).at(-1)
    if (parent !== undefined) facts.push([eid, "block/namespace", pageRef(parent)])
    return eid
  }

  const refsOf = (titles: Iterable<string>) => {
    const out = new Set<number>()
    for (const title of titles) {
      if (title.trim() === "") continue
      out.add(pageRef(title))
      for (const parent of namespaces(title.trim())) out.add(pageRef(parent))
    }
    return out
  }

  const known = (files: ReadonlyArray<PageFile>) => {
    for (const { page, blocks: list } of files) {
      names.set(page.name, numberOf(page.id))
      for (const block of list) {
        const eid = numberOf(block.id)
        owner.set(eid, page.id)
        blocks.set(block.id, eid)
        blocks.set(blockRefId(block), eid)
      }
    }
  }

  const pageFacts = ({ page, blocks: list, path }: PageFile) => {
    const eid = numberOf(page.id)
    facts.push(
      [eid, "block/uuid", uuid(page.id)],
      [eid, "block/name", page.name],
      [eid, "block/original-name", page.title],
      [eid, "block/journal?", page.journalDay !== null],
      [eid, "block/format", keyword("markdown")],
    )
    if (page.journalDay !== null) facts.push([eid, "block/journal-day", page.journalDay])
    const props = typedProperties(page.props)
    if (props.length > 0) {
      facts.push([eid, "block/properties", ednMap(props.map(([key, , v]) => [key, typedText(v)]))])
    }
    const typed = new Map(props.map(([key, , value]) => [key, value]))
    for (const ref of refsOf(listed(typed.get("alias")))) facts.push([eid, "block/alias", ref])
    for (const ref of refsOf(listed(typed.get("tags")))) facts.push([eid, "block/tags", ref])
    const parent = namespaces(page.title).at(-1)
    if (parent !== undefined) facts.push([eid, "block/namespace", pageRef(parent)])
    if (list.length > 0 || props.length > 0) {
      const file = numberOf(`file:${path}`)
      facts.push([file, "file/path", path], [eid, "block/file", file])
    }
    const children = new Map<string | null, Array<Block>>()
    for (const block of list) {
      const siblings = children.get(block.parentId) ?? []
      siblings.push(block)
      children.set(block.parentId, siblings)
    }
    const walk = (parentId: string | null, parentEid: number, inherited: ReadonlySet<number>) => {
      let left = parentEid
      for (const block of children.get(parentId) ?? []) {
        const refs = blockFacts(block, eid, parentEid, left, inherited)
        walk(block.id, numberOf(block.id), new Set([...inherited, ...refs]))
        left = numberOf(block.id)
      }
    }
    walk(null, eid, new Set([eid]))
  }

  const blockFacts = (
    block: Block,
    pageEid: number,
    parentEid: number,
    leftEid: number,
    inherited: ReadonlySet<number>,
  ) => {
    const eid = numberOf(block.id)
    const content = contentOf(block)
    const syntax = analyzeBlock(content)
    facts.push(
      [eid, "block/uuid", uuid(blockRefId(block))],
      [eid, "block/content", content],
      [eid, "block/page", pageEid],
      [eid, "block/parent", parentEid],
      [eid, "block/left", leftEid],
      [eid, "block/format", keyword("markdown")],
    )
    if (syntax.marker !== null) facts.push([eid, "block/marker", syntax.marker])
    if (syntax.priority !== null) facts.push([eid, "block/priority", syntax.priority])
    if (syntax.scheduled !== null) facts.push([eid, "block/scheduled", syntax.scheduled.day])
    if (syntax.deadline !== null) facts.push([eid, "block/deadline", syntax.deadline.day])
    if (syntax.scheduled?.repeater != null || syntax.deadline?.repeater != null) {
      facts.push([eid, "block/repeated?", true])
    }
    if (block.collapsed) facts.push([eid, "block/collapsed?", true])
    const props = typedProperties(block.props)
    const level = HEADING.exec(block.text)?.[1]?.length
    const entries: Array<readonly [string, string]> = [
      ...(level === undefined ? [] : [["heading", String(level)] as const]),
      ...props.map(([key, , value]) => [key, typedText(value)] as const),
    ]
    if (entries.length > 0) facts.push([eid, "block/properties", ednMap(entries)])
    if (props.length > 0) {
      facts.push(
        [
          eid,
          "block/properties-text-values",
          ednMap(props.map(([key, raw]) => [key, JSON.stringify(raw)])),
        ],
        [eid, "block/properties-order", edn(`[${props.map(([key]) => `:${key}`).join(" ")}]`)],
      )
    }
    const typed = new Map(props.map(([key, , value]) => [key, value]))
    const tags = refsOf(listed(typed.get("tags")))
    for (const tag of tags) facts.push([eid, "block/tags", tag])
    const refs = new Set<number>([
      ...tags,
      ...refsOf([
        ...syntax.refs.flatMap((ref) => (ref._tag === "BlockRef" ? [] : [ref.name])),
        ...props.flatMap(([, , value]) => listed(value)),
        ...(syntax.marker === null ? [] : [syntax.marker]),
        ...(syntax.priority === null ? [] : [syntax.priority]),
      ]),
    ])
    for (const ref of syntax.refs) {
      const target = ref._tag === "BlockRef" ? blocks.get(ref.uuid) : undefined
      if (target !== undefined) refs.add(target)
    }
    for (const ref of refs) facts.push([eid, "block/refs", ref])
    for (const ref of new Set([...inherited, ...refs])) facts.push([eid, "block/path-refs", ref])
    return refs
  }

  return {
    names,
    owner,
    known,
    take: (files: ReadonlyArray<PageFile>) => {
      known(files)
      for (const file of files) pageFacts(file)
      return facts.splice(0)
    },
  }
}

const materialize = (facts: ReadonlyArray<Fact>, extra: ReadonlyArray<string>) => {
  const slots = new Map<string, number>()
  const slot = (text: string) => {
    const known = slots.get(text)
    if (known !== undefined) return known
    slots.set(text, slots.size)
    return slots.size - 1
  }
  const planned = facts.map(
    ([e, a, v]) => [e, slot(`:${a}`), typeof v === "object" ? slot(v.edn) : null, v] as const,
  )
  const extras = extra.map(slot)
  const read = readEdn([...slots.keys()])
  return {
    datoms: planned.map(([e, a, at, v]) => [e, read[a], at === null ? v : read[at]] as const),
    extras: extras.map((at) => read[at]),
  }
}

export type Stale = { readonly _tag: "All" } | { readonly _tag: "Pages"; readonly ids: Set<PageId> }

export const createLogseqDb = (files: ReadonlyArray<PageFile>) => {
  const builder = makeBuilder()
  const { datoms, extras } = materialize(builder.take(files), [schema])
  const paths = new Map(files.map((file) => [file.page.id, file.path]))
  const owned = new Map<PageId, ReadonlyArray<number>>()
  const own = (file: PageFile) =>
    owned.set(file.page.id, [
      numberOf(file.page.id),
      ...file.blocks.map((block) => numberOf(block.id)),
    ])
  for (const file of files) own(file)
  let db: Db = datascript.init_db(datoms, extras[0])

  const update = (fresh: ReadonlyArray<Omit<PageFile, "path">>) => {
    const withPaths = fresh.map((file) => ({ ...file, path: paths.get(file.page.id) ?? "" }))
    const retractions = withPaths.flatMap((file) =>
      (owned.get(file.page.id) ?? []).flatMap((eid) =>
        datascript.datoms(db, ":eavt", eid).map((datom) => [":db/retract", eid, datom.a, datom.v]),
      ),
    )
    const { datoms: added } = materialize(builder.take(withPaths), [])
    for (const file of withPaths) own(file)
    db = datascript.db_with(db, [...retractions, ...added.map(([e, a, v]) => [":db/add", e, a, v])])
  }

  return {
    pageOf: (eid: number) => builder.owner.get(eid) ?? null,
    hasPage: (page: Page) => builder.names.get(page.name) === numberOf(page.id),
    update,
    query: (text: string, inputs: ReadonlyArray<unknown>) =>
      plain(datascript.q(text, db, ...inputs)),
  }
}

export type LogseqDb = ReturnType<typeof createLogseqDb>

const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value !== "object" || value === null) return value
  if (Object.getPrototypeOf(value) !== Object.prototype) return String(value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
}
