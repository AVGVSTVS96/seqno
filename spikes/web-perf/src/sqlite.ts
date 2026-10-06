import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
import type { TreeID } from "loro-crdt"
import type { BlockMap } from "./schema.ts"

const SCHEMA = `
  create table pages (id integer primary key, uuid text not null unique, name text not null, journal_day integer);
  create table blocks (id integer primary key, uuid text not null unique, page integer not null, parent integer, ord integer not null, content text not null);
  create table refs (block integer not null, page integer, target_block integer);
  create virtual table blocks_fts using fts5(content, content = 'blocks', content_rowid = 'id');
`

const INDEXES = `
  create index blocks_by_page on blocks (page, parent, ord);
  create index refs_by_page on refs (page);
  create index refs_by_target_block on refs (target_block);
  create index refs_by_block on refs (block);
`

const REF = /\[\[([^\]]+)\]\]|#([\w/-]+)|\(\(([0-9a-f-]{36})\)\)/g

const now = () => performance.now()

export const buildIndex = async (map: BlockMap) => {
  const t0 = now()
  const sqlite3 = await sqlite3InitModule()
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "seqno-web-perf", clearOnInit: true })
  const db = new pool.OpfsSAHPoolDb("/index.sqlite3")
  const t1 = now()

  db.exec(SCHEMA)
  db.exec("begin")
  const insertPage = db.prepare("insert into pages (id, uuid, name, journal_day) values (?, ?, ?, ?)")
  const insertBlock = db.prepare("insert into blocks (id, uuid, page, parent, ord, content) values (?, ?, ?, ?, ?, ?)")
  const insertRef = db.prepare("insert into refs (block, page, target_block) values (?, ?, ?)")

  const pageIds = new Map<string, number>()
  const blockIds = new Map<string, number>()
  const blockRows: { id: number; content: string }[] = []
  const addPage = (uuid: string, name: string, journalDay: number | null) => {
    const id = pageIds.size + 1
    insertPage.bind([id, uuid, name, journalDay]).stepReset()
    pageIds.set(name.toLowerCase(), id)
    return id
  }
  const addBlocks = (page: number, parent: number | null, children: readonly TreeID[]) =>
    children.forEach((treeId, ord) => {
      const { uuid, text, children } = map.entries.get(treeId)!
      const id = blockIds.size + 1
      insertBlock.bind([id, uuid, page, parent, ord, text]).stepReset()
      blockIds.set(uuid, id)
      blockRows.push({ id, content: text })
      addBlocks(page, id, children)
    })
  for (const root of map.roots) {
    const { uuid, title = "", journalDay = null, children } = map.entries.get(root)!
    addBlocks(addPage(uuid, title, journalDay), null, children)
  }
  const t2 = now()

  let refs = 0
  for (const { id, content } of blockRows)
    for (const [, page, tag, block] of content.matchAll(REF)) {
      const name = page ?? tag
      const target = name === undefined ? null : (pageIds.get(name.toLowerCase()) ?? addPage(crypto.randomUUID(), name, null))
      insertRef.bind([id, target, block === undefined ? null : (blockIds.get(block) ?? null)]).stepReset()
      refs++
    }
  const t3 = now()

  db.exec("insert into blocks_fts (blocks_fts) values ('rebuild')")
  const t4 = now()
  db.exec(INDEXES)
  db.exec("commit")
  const t5 = now()
  for (const stmt of [insertPage, insertBlock, insertRef]) stmt.finalize()

  const busiestPage = db.selectValue("select page from refs where page is not null group by page order by count(*) desc limit 1")
  const q0 = now()
  const backlinks = db.selectValues("select b.id from refs r join blocks b on b.id = r.block where r.page = ?", [busiestPage!]).length
  const q1 = now()
  const ftsHits = db.selectValues("select rowid from blocks_fts where blocks_fts match 'roadmap' order by rank limit 50").length
  const q2 = now()
  const dbBytes = Number(db.selectValue("select page_count * page_size from pragma_page_count(), pragma_page_size()"))
  db.close()

  return {
    rows: { pages: pageIds.size, blocks: blockIds.size, refs },
    openMs: t1 - t0,
    insertBlocksMs: t2 - t1,
    insertRefsMs: t3 - t2,
    ftsRebuildMs: t4 - t3,
    indexesAndCommitMs: t5 - t4,
    totalBuildMs: t5 - t1,
    dbBytes,
    sampleQueries: { backlinksOfBusiestPage: { rows: backlinks, ms: q1 - q0 }, ftsMatchRoadmap: { rows: ftsHits, ms: q2 - q1 } },
  }
}
