import { createGraphModel, createRng, type Edit, type Graph, type GraphModel } from "../../shared/fixture/src/index.ts"
import type { Db, SqlValue } from "./db.ts"
import type { BlockFacets, PageFacets } from "./fields.ts"
import { lower, namespacesOf, parseBlock, toNum, type Parsed, type Task } from "./markdown.ts"
import { SCHEMA } from "./schema.ts"

export type Keys = Record<string, string[]>

export type Change =
  | { readonly kind: "block"; readonly before: BlockFacets | null; readonly after: BlockFacets | null; readonly keys: Keys }
  | { readonly kind: "other"; readonly keys: Keys }

export interface Index {
  readonly db: Db
  readonly model: GraphModel
  readonly apply: (edit: Edit) => Change[]
}

export interface IndexOptions {
  readonly now?: () => number
}

const EMPTY: Parsed = { task: null, refs: [], tags: [], props: [], propsOnly: false }
const DAY = 86_400_000
const TASK_FIELDS = ["status", "priority", "scheduled", "deadline"] as const

const symdiff = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
  const sa = new Set(a)
  const sb = new Set(b)
  return [...new Set([...a.filter((x) => !sb.has(x)), ...b.filter((x) => !sa.has(x))])]
}

const propKeysChanged = (a: Parsed["props"], b: Parsed["props"]) => {
  const flat = (ps: Parsed["props"], key: string) => ps.flatMap(([k, v]) => (k === key ? [v] : [])).join("\u0000")
  const keys = new Set([...a, ...b].map(([k]) => k))
  return [...keys].filter((k) => flat(a, k) !== flat(b, k))
}

const taskFieldsChanged = (a: Task | null, b: Task | null) => TASK_FIELDS.filter((f) => (a?.[f] ?? null) !== (b?.[f] ?? null))

const facetKeys = (a: Parsed, b: Parsed, keys: Keys): Keys => {
  const refs = symdiff(a.refs, b.refs)
  const tags = symdiff(a.tags, b.tags)
  const props = propKeysChanged(a.props, b.props)
  if (refs.length > 0) keys.ref = refs
  if (tags.length > 0) keys.tag = tags
  if (props.length > 0) keys.property = props
  for (const f of taskFieldsChanged(a.task, b.task)) keys[`task.${f}`] = []
  return keys
}

interface Derived {
  readonly tags: ReadonlyArray<string>
  readonly aliases: ReadonlyArray<string>
  readonly props: ReadonlyArray<readonly [string, string]>
}

const derivePage = (name: string, firstContent: string | null): Derived => {
  const parsed = firstContent === null ? EMPTY : parseBlock(firstContent)
  const props = parsed.propsOnly ? parsed.props : []
  const values = (key: string) => [...new Set(props.flatMap(([k, v]) => (k === key ? [v] : [])))]
  return { tags: values("tags"), aliases: values("alias").filter((a) => a !== name), props }
}

const YEAR_END = Date.UTC(2025, 11, 31, 23, 59)

const timestamps = (graph: Graph) => {
  const rng = createRng(graph.options.seed ^ 0x51ed)
  const dayOf = new Map(graph.pages.map((p) => [p.id, p.journalDay]))
  return graph.blocks.map((b) => {
    const day = dayOf.get(b.pageId)
    const created =
      day != null
        ? Date.UTC(Math.floor(day / 10_000), (Math.floor(day / 100) % 100) - 1, day % 100) + rng.int(6 * 3_600_000, 23 * 3_600_000)
        : Date.UTC(2025, 0, 1) + rng.int(0, 364 * DAY)
    return [created, created + Math.floor(rng.next() ** 3 * (YEAR_END - created))] as const
  })
}

export const createIndex = (db: Db, graph: Graph, options: IndexOptions = {}): Index => {
  let clock = Date.UTC(2025, 11, 31, 12)
  const now = options.now ?? (() => (clock += 1_000))
  const model = createGraphModel(graph)
  const blockRid = new Map<string, number>()
  const pageRid = new Map<string, number>()
  const pages = new Map<number, PageFacets>()
  let nextRid = 1

  const writeRefs = (rid: number, p: Parsed) => {
    const tags = new Set(p.tags)
    for (const r of p.refs) db.run("INSERT INTO refs VALUES (?, ?, ?)", [rid, r, tags.has(r) ? 1 : 0])
  }
  const writeProps = (rid: number, p: Parsed) => {
    for (const [k, v] of p.props) db.run("INSERT INTO props VALUES (?, ?, ?, ?)", [rid, k, v, toNum(v)])
  }
  const writeTask = (rid: number, p: Parsed) => {
    const t = p.task
    if (t) db.run("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)", [rid, t.status, t.priority, t.scheduled, t.deadline])
  }
  const writeBlock = (rid: number, content: string, p: Parsed) => {
    db.run("INSERT INTO fts(rowid, content) VALUES (?, ?)", [rid, content])
    writeRefs(rid, p)
    writeProps(rid, p)
    writeTask(rid, p)
  }
  const clearBlock = (rid: number) => {
    db.run("DELETE FROM fts WHERE rowid = ?", [rid])
    db.run("DELETE FROM refs WHERE block = ?", [rid])
    db.run("DELETE FROM props WHERE block = ?", [rid])
    db.run("DELETE FROM tasks WHERE block = ?", [rid])
  }

  const writeDerived = (prid: number, d: Derived) => {
    for (const t of d.tags) db.run("INSERT OR IGNORE INTO page_tags VALUES (?, ?)", [prid, t])
    for (const a of d.aliases) db.run("INSERT OR IGNORE INTO page_names VALUES (?, ?, 1)", [a, prid])
    for (const [k, v] of d.props) db.run("INSERT INTO page_props VALUES (?, ?, ?, ?)", [prid, k, v, toNum(v)])
  }
  const clearDerived = (prid: number) => {
    db.run("DELETE FROM page_tags WHERE page = ?", [prid])
    db.run("DELETE FROM page_names WHERE page = ? AND alias = 1", [prid])
    db.run("DELETE FROM page_props WHERE page = ?", [prid])
  }

  const node = (id: string) => {
    const n = model.nodes.get(id)
    if (n === undefined) throw new Error(`unknown node ${id}`)
    return n
  }
  const pageOf = (id: string) => {
    let at = id
    for (let up = node(at).parent; up !== null; up = node(at).parent) at = up
    return at
  }
  const firstContent = (pageId: string) => {
    const first = node(pageId).children[0]
    return first === undefined ? null : node(first).content
  }
  const subtree = (id: string) => {
    const out: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const at = stack.pop()!
      out.push(at)
      stack.push(...node(at).children)
    }
    return out
  }
  const rid = (id: string) => blockRid.get(id)!
  const row = (r: number) => db.all("SELECT page, created, updated FROM blocks WHERE rid = ?", [r])[0] as [number, number, number]
  const facets = (id: string, content: string, parsed: Parsed, created: number, updated: number, page: PageFacets): BlockFacets => ({
    id,
    content,
    parsed,
    created,
    updated,
    page,
  })

  db.exec(SCHEMA)
  db.transaction(() => {
    graph.pages.forEach((p, i) => {
      const prid = i + 1
      const name = lower(p.name)
      pageRid.set(p.id, prid)
      db.run("INSERT INTO pages VALUES (?, ?, ?, ?, ?)", [prid, p.id, p.name, name, p.journalDay])
      db.run("INSERT INTO page_names VALUES (?, ?, 0)", [name, prid])
      const namespaces = namespacesOf(name)
      for (const ns of namespaces) db.run("INSERT INTO page_ns VALUES (?, ?)", [prid, ns])
      const derived = derivePage(name, firstContent(p.id))
      writeDerived(prid, derived)
      pages.set(prid, { rid: prid, name, day: p.journalDay, namespaces, ...derived })
    })
    const times = timestamps(graph)
    graph.blocks.forEach((b, i) => {
      const r = nextRid++
      blockRid.set(b.id, r)
      const [created, updated] = times[i]!
      const parent: SqlValue = b.parentId === null ? null : blockRid.get(b.parentId)!
      db.run("INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)", [r, b.id, pageRid.get(b.pageId)!, parent, b.content, created, updated])
      writeBlock(r, b.content, parseBlock(b.content))
    })
  })

  const pageChanged = (pageId: string): Change[] => {
    const prid = pageRid.get(pageId)!
    const cur = pages.get(prid)!
    const next = derivePage(cur.name, firstContent(pageId))
    const keys: Keys = {}
    const tags = symdiff(cur.tags, next.tags)
    const props = propKeysChanged(cur.props, next.props)
    if (tags.length > 0) keys["page.tag"] = tags
    if (props.length > 0) keys["page.property"] = props
    if (symdiff(cur.aliases, next.aliases).length > 0) keys["page.alias"] = []
    if (Object.keys(keys).length === 0) return []
    clearDerived(prid)
    writeDerived(prid, next)
    pages.set(prid, { ...cur, ...next })
    return [{ kind: "other", keys }]
  }

  const contentChanged = (id: string, before: string, after: string): Change[] => {
    const r = rid(id)
    const [prid, created, updated] = row(r)
    const page = pages.get(prid)!
    const a = parseBlock(before)
    const b = parseBlock(after)
    const at = now()
    db.run("UPDATE blocks SET content = ?, updated = ? WHERE rid = ?", [after, at, r])
    db.run("DELETE FROM fts WHERE rowid = ?", [r])
    db.run("INSERT INTO fts(rowid, content) VALUES (?, ?)", [r, after])
    const keys = facetKeys(a, b, { text: [], updated: [] })
    if (keys.ref || keys.tag) {
      db.run("DELETE FROM refs WHERE block = ?", [r])
      writeRefs(r, b)
    }
    if (keys.property) {
      db.run("DELETE FROM props WHERE block = ?", [r])
      writeProps(r, b)
    }
    if (TASK_FIELDS.some((f) => keys[`task.${f}`])) {
      db.run("DELETE FROM tasks WHERE block = ?", [r])
      writeTask(r, b)
    }
    const change: Change = {
      kind: "block",
      before: facets(id, before, a, created, updated, page),
      after: facets(id, after, b, created, at, page),
      keys,
    }
    const pageId = pageOf(id)
    return node(pageId).children[0] === id ? [change, ...pageChanged(pageId)] : [change]
  }

  const apply = (edit: Edit): Change[] =>
    db.transaction(() => {
      switch (edit.kind) {
        case "insertText":
        case "deleteText": {
          const before = node(edit.block).content
          model.apply(edit)
          return contentChanged(edit.block, before, node(edit.block).content)
        }
        case "createBlock": {
          model.apply(edit)
          const pageId = pageOf(edit.block)
          const prid = pageRid.get(pageId)!
          const r = nextRid++
          blockRid.set(edit.block, r)
          const at = now()
          const parent: SqlValue = pageRid.has(edit.parent) ? null : rid(edit.parent)
          db.run("INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?, ?)", [r, edit.block, prid, parent, edit.text, at, at])
          const parsed = parseBlock(edit.text)
          writeBlock(r, edit.text, parsed)
          const keys = facetKeys(EMPTY, parsed, { exist: [], tree: [], text: [], created: [], updated: [] })
          return [{ kind: "block", before: null, after: facets(edit.block, edit.text, parsed, at, at, pages.get(prid)!), keys }, ...pageChanged(pageId)]
        }
        case "deleteBlock": {
          const pageId = pageOf(edit.block)
          const changes: Change[] = subtree(edit.block).map((id) => {
            const r = rid(id)
            const [prid, created, updated] = row(r)
            const content = node(id).content
            const parsed = parseBlock(content)
            clearBlock(r)
            db.run("DELETE FROM blocks WHERE rid = ?", [r])
            blockRid.delete(id)
            const keys = facetKeys(parsed, EMPTY, { exist: [], tree: [], text: [], created: [], updated: [] })
            return { kind: "block", before: facets(id, content, parsed, created, updated, pages.get(prid)!), after: null, keys }
          })
          model.apply(edit)
          return [...changes, ...pageChanged(pageId)]
        }
        case "moveBlock": {
          const oldPage = pageOf(edit.block)
          model.apply(edit)
          const newPage = pageOf(edit.block)
          const parent: SqlValue = pageRid.has(edit.parent) ? null : rid(edit.parent)
          db.run("UPDATE blocks SET parent = ? WHERE rid = ?", [parent, rid(edit.block)])
          const changes: Change[] = [{ kind: "other", keys: { tree: [] } }]
          if (newPage !== oldPage) {
            const from = pages.get(pageRid.get(oldPage)!)!
            const to = pages.get(pageRid.get(newPage)!)!
            for (const id of subtree(edit.block)) {
              const r = rid(id)
              const [, created, updated] = row(r)
              db.run("UPDATE blocks SET page = ? WHERE rid = ?", [to.rid, r])
              const content = node(id).content
              const parsed = parseBlock(content)
              changes.push({
                kind: "block",
                before: facets(id, content, parsed, created, updated, from),
                after: facets(id, content, parsed, created, updated, to),
                keys: { move: [] },
              })
            }
          }
          return [...changes, ...pageChanged(oldPage), ...(newPage === oldPage ? [] : pageChanged(newPage))]
        }
      }
    })

  return { db, model, apply }
}
