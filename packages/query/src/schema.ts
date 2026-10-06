export const SCHEMA = `
CREATE TABLE pages (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE, day INTEGER);
CREATE INDEX pages_day ON pages(day);

CREATE TABLE page_names (name TEXT NOT NULL, page INTEGER NOT NULL, alias INTEGER NOT NULL, PRIMARY KEY (name, page)) WITHOUT ROWID;
CREATE INDEX page_names_page ON page_names(page);

CREATE TABLE page_tags (page INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (tag, page)) WITHOUT ROWID;
CREATE INDEX page_tags_page ON page_tags(page);

CREATE TABLE page_ns (page INTEGER NOT NULL, ns TEXT NOT NULL, PRIMARY KEY (ns, page)) WITHOUT ROWID;
CREATE INDEX page_ns_page ON page_ns(page);

CREATE TABLE page_props (page INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, num REAL);
CREATE INDEX page_props_kv ON page_props(key, value);
CREATE INDEX page_props_kn ON page_props(key, num);
CREATE INDEX page_props_page ON page_props(page);

CREATE TABLE blocks (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, page INTEGER NOT NULL, parent INTEGER, content TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX blocks_page ON blocks(page);
CREATE INDEX blocks_parent ON blocks(parent);
CREATE INDEX blocks_created ON blocks(created);
CREATE INDEX blocks_updated ON blocks(updated);

CREATE TABLE tasks (block INTEGER PRIMARY KEY, status TEXT, priority TEXT, scheduled INTEGER, deadline INTEGER);
CREATE INDEX tasks_status ON tasks(status);
CREATE INDEX tasks_priority ON tasks(priority);
CREATE INDEX tasks_scheduled ON tasks(scheduled);
CREATE INDEX tasks_deadline ON tasks(deadline);

CREATE TABLE refs (block INTEGER NOT NULL, target TEXT NOT NULL, tag INTEGER NOT NULL, PRIMARY KEY (target, block)) WITHOUT ROWID;
CREATE INDEX refs_block ON refs(block);

CREATE TABLE props (block INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, num REAL);
CREATE INDEX props_kv ON props(key, value);
CREATE INDEX props_kn ON props(key, num);
CREATE INDEX props_block ON props(block);

CREATE VIRTUAL TABLE fts USING fts5(content, content='', contentless_delete=1);
`

export const ALIASES_SQL = `SELECT ?1 UNION SELECT n2.name FROM page_names n1 JOIN page_names n2 ON n2.page = n1.page WHERE n1.name = ?1`
