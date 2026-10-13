import { Schema } from "effect"
import { GraphEvent, type BlockId, type PageId } from "@seqno/domain"
import {
  NO_FACETS,
  blockFacets,
  changedPropKeys,
  changedTaskFields,
  pageFacets,
  symmetricDifference,
  toNum,
  type BlockFacets,
  type PageFacets,
  type Prop,
} from "./facets.ts"
import { touch, type Changes, type Facet } from "./keys.ts"
import { IndexError, type Row, type Statements } from "./sqlite.ts"

const Rid = Schema.Int
const decodeRid = Schema.decodeUnknownSync(Schema.Tuple([Rid]))
const decodeBlock = Schema.decodeUnknownSync(
  Schema.Tuple([Rid, Rid, Schema.NullOr(Rid), Schema.String, Schema.Number, Schema.Number]),
)
const decodePage = Schema.decodeUnknownSync(
  Schema.Tuple([Rid, Schema.String, Schema.String, Schema.NullOr(Schema.Number)]),
)
const decodeName = Schema.decodeUnknownSync(Schema.Tuple([Schema.String]))
const decodeRef = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.Number]))
const decodeProp = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))
const decodeTask = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.NullOr(Schema.String),
    priority: Schema.NullOr(Schema.String),
    scheduled: Schema.NullOr(Schema.Number),
    deadline: Schema.NullOr(Schema.Number),
  }),
)

const NO_PAGE_FACETS: PageFacets = { namespaces: [], tags: [], aliases: [], props: [] }

const LIFECYCLE: ReadonlyArray<Facet> = ["exist", "tree", "text", "created", "updated"]

const SUBTREE = `WITH RECURSIVE sub(rid) AS (SELECT ?1 UNION ALL SELECT b.rid FROM blocks b JOIN sub ON b.parent = sub.rid)`

const LINKED_FROM_SUBTREE = `${SUBTREE}
SELECT n.page, count(DISTINCT r.block) FROM sub
JOIN refs r ON r.block = sub.rid
JOIN page_names n ON n.name = r.target
WHERE n.page IN (?2, ?3)
GROUP BY n.page`

const COUNT_BACKLINKS = `
UPDATE pages SET backlinks = (
  SELECT count(DISTINCT r.block) FROM page_names n
  JOIN refs r ON r.target = n.name
  JOIN blocks b ON b.rid = r.block
  WHERE n.page = ?1 AND b.page != ?1)
WHERE rid = ?1`

const names = (rows: ReadonlyArray<Row>) => rows.map((row) => decodeName(row)[0])

const decodeCount = Schema.decodeUnknownSync(Schema.Tuple([Rid, Schema.Int]))

const ridOf = (rows: ReadonlyArray<Row>, missing: string): number => {
  const row = rows[0]
  if (row === undefined) throw new IndexError({ message: missing })
  return decodeRid(row)[0]
}

export const indexer = (db: Statements, changes: Changes) => {
  const backlinks = new Map<number, number>()
  const relink = (page: number, by: number) => backlinks.set(page, (backlinks.get(page) ?? 0) + by)

  const recount = (page: number) => {
    backlinks.delete(page)
    db.run(COUNT_BACKLINKS, [page])
  }

  const linkedPages = (targets: ReadonlyArray<string>, from: number) => {
    const pages = new Set<number>()
    for (const target of targets)
      for (const row of db.all("SELECT page FROM page_names WHERE name = ?", [target]))
        pages.add(decodeRid(row)[0])
    pages.delete(from)
    return pages
  }

  const pageRid = (id: PageId) =>
    ridOf(
      db.all("SELECT rid FROM pages WHERE id = ?", [id]),
      `page ${id} is not indexed: send its PageUpserted before its blocks`,
    )

  const blockRid = (id: BlockId) =>
    ridOf(
      db.all("SELECT rid FROM blocks WHERE id = ?", [id]),
      `block ${id} is not indexed: send a parent's BlockUpserted before its children`,
    )

  const readBlock = (id: BlockId) => {
    const row = db.all(
      "SELECT rid, page, parent, content, created, updated FROM blocks WHERE id = ?",
      [id],
    )[0]
    return row === undefined ? undefined : decodeBlock(row)
  }

  const readFacets = (rid: number): BlockFacets => {
    const refs = db
      .all("SELECT target, tag FROM refs WHERE block = ?", [rid])
      .map((row) => decodeRef(row))
    const task = db.all("SELECT status, priority, scheduled, deadline FROM tasks WHERE block = ?", [
      rid,
    ])[0]
    return {
      refs: refs.map(([target]) => target),
      tags: refs.flatMap(([target, tag]) => (tag === 1 ? [target] : [])),
      props: db
        .all("SELECT key, value FROM props WHERE block = ? ORDER BY rowid", [rid])
        .map((row) => decodeProp(row)),
      task:
        task === undefined
          ? null
          : decodeTask({
              status: task[0],
              priority: task[1],
              scheduled: task[2],
              deadline: task[3],
            }),
    }
  }

  const writeProps = (table: "props" | "page_props", owner: number, props: ReadonlyArray<Prop>) => {
    const column = table === "props" ? "block" : "page"
    db.run(`DELETE FROM ${table} WHERE ${column} = ?`, [owner])
    for (const [key, value] of props)
      db.run(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`, [owner, key, value, toNum(value)])
  }

  const syncFacets = (rid: number, page: number, before: BlockFacets, after: BlockFacets) => {
    const refs = symmetricDifference(before.refs, after.refs)
    const tags = symmetricDifference(before.tags, after.tags)
    const props = changedPropKeys(before.props, after.props)
    const taskFields = changedTaskFields(before.task, after.task)
    if (refs.length > 0) {
      const was = linkedPages(before.refs, page)
      const now = linkedPages(after.refs, page)
      for (const linked of was) if (!now.has(linked)) relink(linked, -1)
      for (const linked of now) if (!was.has(linked)) relink(linked, 1)
    }
    if (refs.length > 0 || tags.length > 0) {
      db.run("DELETE FROM refs WHERE block = ?", [rid])
      const tagged = new Set(after.tags)
      for (const target of after.refs)
        db.run("INSERT INTO refs VALUES (?, ?, ?)", [rid, target, tagged.has(target) ? 1 : 0])
      if (refs.length > 0) touch(changes, "ref", refs)
      if (tags.length > 0) touch(changes, "tag", tags)
    }
    if (props.length > 0) {
      writeProps("props", rid, after.props)
      touch(changes, "property", props)
    }
    if (taskFields.length > 0) {
      db.run("DELETE FROM tasks WHERE block = ?", [rid])
      const task = after.task
      if (task !== null)
        db.run("INSERT INTO tasks VALUES (?, ?, ?, ?, ?)", [
          rid,
          task.status,
          task.priority,
          task.scheduled,
          task.deadline,
        ])
      for (const field of taskFields) touch(changes, `task.${field}`)
    }
  }

  const removeBlock = (rid: number, page: number) => {
    syncFacets(rid, page, readFacets(rid), NO_FACETS)
    db.run("DELETE FROM fts WHERE rowid = ?", [rid])
    db.run("DELETE FROM blocks WHERE rid = ?", [rid])
  }

  const moveToPage = (rid: number, from: number, to: number) => {
    for (const row of db.all(LINKED_FROM_SUBTREE, [rid, from, to])) {
      const [page, blocks] = decodeCount(row)
      relink(page, page === from ? blocks : -blocks)
    }
    db.run(`${SUBTREE} UPDATE blocks SET page = ?2 WHERE rid IN (SELECT rid FROM sub)`, [rid, to])
    touch(changes, "move")
  }

  const touchLifecycle = () => {
    for (const facet of LIFECYCLE) touch(changes, facet)
  }

  const readPageFacets = (rid: number): PageFacets => ({
    namespaces: names(db.all("SELECT ns FROM page_ns WHERE page = ?", [rid])),
    tags: names(db.all("SELECT tag FROM page_tags WHERE page = ?", [rid])),
    aliases: names(db.all("SELECT name FROM page_names WHERE page = ? AND alias = 1", [rid])),
    props: db
      .all("SELECT key, value FROM page_props WHERE page = ? ORDER BY rowid", [rid])
      .map((row) => decodeProp(row)),
  })

  const syncPageFacets = (rid: number, before: PageFacets, after: PageFacets) => {
    const namespaces = symmetricDifference(before.namespaces, after.namespaces)
    const tags = symmetricDifference(before.tags, after.tags)
    const aliases = symmetricDifference(before.aliases, after.aliases)
    const props = changedPropKeys(before.props, after.props)
    if (namespaces.length > 0) {
      db.run("DELETE FROM page_ns WHERE page = ?", [rid])
      for (const ns of after.namespaces) db.run("INSERT INTO page_ns VALUES (?, ?)", [rid, ns])
      touch(changes, "page.namespace", namespaces)
    }
    if (tags.length > 0) {
      db.run("DELETE FROM page_tags WHERE page = ?", [rid])
      for (const tag of after.tags) db.run("INSERT INTO page_tags VALUES (?, ?)", [rid, tag])
      touch(changes, "page.tag", tags)
    }
    if (aliases.length > 0) {
      db.run("DELETE FROM page_names WHERE page = ? AND alias = 1", [rid])
      for (const alias of after.aliases)
        db.run("INSERT OR IGNORE INTO page_names VALUES (?, ?, 1)", [alias, rid])
      recount(rid)
      touch(changes, "page.alias")
    }
    if (props.length > 0) {
      writeProps("page_props", rid, after.props)
      touch(changes, "page.property", props)
    }
  }

  const index = GraphEvent.match({
    PageUpserted: ({ page }) => {
      const after = pageFacets(page)
      const row = db.all("SELECT rid, name, name_lc, day FROM pages WHERE id = ?", [page.id])[0]
      if (row === undefined) {
        const rid = ridOf(
          db.all("INSERT INTO pages (id, name, name_lc, day) VALUES (?, ?, ?, ?) RETURNING rid", [
            page.id,
            page.title,
            page.name,
            page.journalDay,
          ]),
          `page ${page.id} could not be inserted`,
        )
        db.run("INSERT INTO page_names VALUES (?, ?, 0)", [page.name, rid])
        syncPageFacets(rid, NO_PAGE_FACETS, after)
        recount(rid)
        touch(changes, "page.name")
        touch(changes, "page.alias")
        return
      }
      const [rid, title, name, day] = decodePage(row)
      syncPageFacets(rid, readPageFacets(rid), after)
      if (title === page.title && name === page.name && day === page.journalDay) return
      db.run("UPDATE pages SET name = ?, name_lc = ?, day = ? WHERE rid = ?", [
        page.title,
        page.name,
        page.journalDay,
        rid,
      ])
      touch(changes, "page.name")
      if (name === page.name) return
      db.run("UPDATE page_names SET name = ? WHERE page = ? AND alias = 0", [page.name, rid])
      recount(rid)
      touch(changes, "page.alias")
    },

    PageDeleted: ({ pageId }) => {
      const row = db.all("SELECT rid FROM pages WHERE id = ?", [pageId])[0]
      if (row === undefined) return
      const [rid] = decodeRid(row)
      const blocks = db
        .all("SELECT rid FROM blocks WHERE page = ?", [rid])
        .map((r) => decodeRid(r)[0])
      for (const block of blocks) removeBlock(block, rid)
      if (blocks.length > 0) touchLifecycle()
      syncPageFacets(rid, readPageFacets(rid), NO_PAGE_FACETS)
      db.run("DELETE FROM page_names WHERE page = ?", [rid])
      db.run("DELETE FROM pages WHERE rid = ?", [rid])
      touch(changes, "page.name")
      touch(changes, "page.alias")
    },

    BlockUpserted: ({ block, createdAt, updatedAt }) => {
      const page = pageRid(block.pageId)
      const parent = block.parentId === null ? null : blockRid(block.parentId)
      const after = blockFacets(block.text, block.props)
      const old = readBlock(block.id)
      if (old === undefined) {
        const rid = ridOf(
          db.all(
            "INSERT INTO blocks (id, page, parent, content, created, updated) VALUES (?, ?, ?, ?, ?, ?) RETURNING rid",
            [block.id, page, parent, block.text, createdAt, updatedAt],
          ),
          `block ${block.id} could not be inserted`,
        )
        db.run("INSERT INTO fts (rowid, content) VALUES (?, ?)", [rid, block.text])
        syncFacets(rid, page, NO_FACETS, after)
        touchLifecycle()
        return
      }
      const [rid, oldPage, oldParent, content, created, updated] = old
      db.run("UPDATE blocks SET parent = ?, content = ?, created = ?, updated = ? WHERE rid = ?", [
        parent,
        block.text,
        createdAt,
        updatedAt,
        rid,
      ])
      if (content !== block.text) {
        db.run("DELETE FROM fts WHERE rowid = ?", [rid])
        db.run("INSERT INTO fts (rowid, content) VALUES (?, ?)", [rid, block.text])
        touch(changes, "text")
      }
      if (created !== createdAt) touch(changes, "created")
      if (updated !== updatedAt) touch(changes, "updated")
      if (oldParent !== parent) touch(changes, "tree")
      if (oldPage !== page) moveToPage(rid, oldPage, page)
      syncFacets(rid, page, readFacets(rid), after)
    },

    BlockMoved: ({ blockId, pageId, parentId }) => {
      const old = readBlock(blockId)
      if (old === undefined)
        throw new IndexError({ message: `block ${blockId} is not indexed, so it cannot move` })
      const [rid, oldPage, oldParent] = old
      const page = pageRid(pageId)
      const parent = parentId === null ? null : blockRid(parentId)
      if (oldParent !== parent) db.run("UPDATE blocks SET parent = ? WHERE rid = ?", [parent, rid])
      touch(changes, "tree")
      if (oldPage !== page) moveToPage(rid, oldPage, page)
    },

    BlockDeleted: ({ blockId }) => {
      const old = readBlock(blockId)
      if (old === undefined) return
      const subtree = db.all(`${SUBTREE} SELECT rid FROM sub`, [old[0]]).map((r) => decodeRid(r)[0])
      for (const rid of subtree) removeBlock(rid, old[1])
      touchLifecycle()
    },
  })

  const settle = () => {
    for (const [page, by] of backlinks)
      if (by !== 0) db.run("UPDATE pages SET backlinks = backlinks + ? WHERE rid = ?", [by, page])
    backlinks.clear()
  }

  return { index, settle }
}
