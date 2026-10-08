# Architecture

seqno is a local-first outliner that reads Logseq graphs. Everything runs on your device. Devices sync through a shared folder, such as one in iCloud Drive, that the operating system copies between them. There is no seqno server.

Why each piece was chosen, with the numbers behind it, is in [decisions.md](decisions.md). What works today and what doesn't is in [roadmap.md](roadmap.md).

## Runtime

```
┌─ UI thread ─────────────────────────────────────────────────┐
│  React shell      routes, sidebars, Mod+K search            │
│  @seqno/outliner  virtualized block tree, selection, drag   │
│  @seqno/editor    CodeMirror, mounted on the focused block  │
│  @seqno/syntax    parses block text (same parser as core)   │
└──────────────┬───────────────────────────────▲──────────────┘
               │ commands, reads               │ results, live streams
               ▼                               │
     @seqno/rpc: Effect RPC over a Web Worker, every message a Schema
               │                               │
┌─ core worker  apps/web/src/worker ───────────┴──────────────┐
│  Graph    @seqno/graph    Loro doc: movable tree + text     │
│  Index    @seqno/index    SQLite: refs, full text, queries  │
│  Queries  @seqno/query    {{query}} / Dataview -> SQL       │
│  Import   @seqno/interop  Logseq markdown -> pages          │
│  Vault    @seqno/vault    edit-log files, sync, compaction  │
└──────────────────────────────┬──────────────────────────────┘
                               │ atomic writes, listings
                               ▼
   graph folder (OPFS, or a folder picked with File System Access)
     updates/<deviceId>/<n>.loro   snapshots/<hash>.loro   seen/<deviceId>.json
     journals/  pages/  logseq/config.edn  assets/          (Logseq's own files)
```

The UI never touches Loro, SQLite or files. It sends commands and subscribes to streams. Each tab opens one graph and holds a Web Lock on it, so a second tab on the same graph waits instead of writing.

### One edit, end to end

1. Typing becomes a `Command` (`EditText` with UTF-16 offsets, as CodeMirror reports them), sent with `Dispatch`.
2. The worker applies it to the Loro doc and commits. Loro's change events become `GraphEvent`s (`PageUpserted`, `BlockUpserted`, `BlockMoved`, ...), parents before children.
3. The index applies those events in one SQLite transaction and wakes only the live queries that read what changed.
4. Watches on the touched pages re-read them, and the UI re-renders those rows.
5. Every 250 ms the graph exports its new ops, and the vault writes them as one update file.
6. Every 5 s the vault lists the folder and merges other devices' files. Merged ops go through steps 2 to 4 too, so local and remote edits share one path.

## Data model

One Loro document per graph. Pages and blocks live in one movable tree:

```
tree "blocks"
  page   (root node)   uuid, title, journalDay?, props, propKeys
    block (child)      uuid, text (LoroText), props, propKeys, collapsed?, created, updated
      block ...
```

- **Pages are root nodes, blocks are their descendants.** Sibling order is the tree's own position index, not a field.
- **Each block's text is its own `LoroText`.** Two devices typing in one block merge character by character.
- **Moves are tree moves.** A block moved on two devices ends up in one place, and two concurrent moves that would form a cycle can't.
- **Properties** (`key:: value`) live in a `props` map, with a `propKeys` list that keeps the order they were written in. Refs, tags, block refs, tasks and dates stay in the text and are parsed by `@seqno/syntax`.
- **Ids** are UUIDv7 (`BlockId`, `PageId`). A page's `name` is its title, NFC-normalized, trimmed and lowercased. Older Logseq `id::` values that aren't UUIDv7 are kept in `props.id`.
- **Commands** (`@seqno/domain`): `CreatePage`, `RenamePage`, `DeletePage`, `InsertBlock(s)`, `EditText`, `SplitBlock`, `MergeWithPrevious`, `Indent`, `Outdent`, `MoveBlocks`, `DeleteBlocks`, `SetCollapsed`, `SetProperty`, `Undo`, `Redo`.
- **Undo** uses Loro's `UndoManager`. Typing in one block is one step, every other command is its own step, and edits from other devices are never undone.

## Edit log and sync

| File                          | Written by                | Holds                                                                           |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `updates/<deviceId>/<n>.loro` | that device only          | its own new ops. `n` is the first op counter in the file, so names never repeat |
| `snapshots/<hash>.loro`       | the device that compacted | the whole doc. `hash` is sha256 of the writer's peer id and the bytes           |
| `seen/<deviceId>.json`        | that device only          | what it has merged, and which snapshots it downloaded and checksummed           |

Each sync pass: list the folder, merge new files, check snapshots, read other devices' `seen`, write its own, maybe compact, maybe delete.

- **Compaction** writes a snapshot once 100 or more update files aren't covered by one, at most once an hour.
- **Deletion.** A device deletes only files it wrote. An update file goes once every member device has merged it and a _confirmed_ snapshot covers it. Confirmed means a different device downloaded it, checked its checksum and said so in its `seen` file. That is the only proof the snapshot reached the server.
- **Why one writer per file.** A synced folder has no locks. When two devices write the same file, the folder keeps one version or makes a conflict copy. With one writer per file there is nothing to fight over, and a conflict copy iCloud still makes now and then is just a copy of Loro ops, which merges harmlessly because importing an op twice changes nothing. File names are op counters, so a name is never reused either.
- **iCloud Drive is only the transport.** seqno reads and writes files; the OS uploads and downloads them. So the vault handles what iCloud does: files that are listed but not downloaded yet or evicted again (placeholders), conflict copies, and file names stored in NFD. A file counts only after it reads and decodes with a valid checksum, never because it is listed. Sync file names are plain ASCII, and every write is atomic.
- **Where the folder lives.** On the web: OPFS, the browser's private file storage, for local-only graphs (the demo graph), or a folder picked with the File System Access API in Chrome or Edge. Desktop (planned) uses plain file access. iOS (planned) uses the app's own iCloud container, shown as iCloud Drive › seqno.

### Import and the markdown mirror

Opening a folder that has no edit log yet imports its Logseq markdown (`journals/` and `pages/`, read with the name and date formats in `logseq/config.edn`) as one load that undo can't take back. From then on the edit log is the source of truth.

`@seqno/interop` also has the mirror writer: one designated device writes the graph back as Logseq markdown, touching only changed files. A canonical Logseq graph round-trips to the same bytes. The app doesn't run it yet.

## Index

SQLite holds everything reads need: pages, names and aliases, tags, namespaces, properties, blocks, tasks, refs, and an FTS5 table for full text. It runs as sqlite-wasm in the worker (node:sqlite in tests).

- **A rebuildable cache.** It is never synced. Each write stores the Loro version it reflects in the same transaction, next to a schema version. When either one doesn't match the graph, the index is dropped and rebuilt from the graph. That makes relaxed durability safe (`journal_mode=memory`, `synchronous=off`).
- **Today it lives in memory** and is filled from the edit log on every open. A driver that keeps it in OPFS (`opfs-sahpool`) exists for when opens become lazy.
- **Live queries re-run only when touched.** Each query lists the keys it reads, such as `tag:database`, `task.status` or `text`. Each write compares a block's old and new refs, tags, task and properties, and wakes only the keys that changed. Typing plain words touches only `text` and `updated`. Backlinks, unlinked references, block reference counts and page stats are live the same way.
- **Search** matches page names and aliases by substring, and block text through FTS5 with the last word as a prefix. User text is always quoted, so FTS syntax in it can't break the query.

## Queries

The same query in both syntaxes:

```
{{query (and (task todo) (not (under (task doing))))}}
{{query LIST WHERE task.status = todo AND NOT UNDER (task.status = doing)}}
```

- **Logseq-style first.** Logseq's simple queries paste in and run unchanged. seqno adds typed fields (`task.deadline <= +7d`), `sort-by`, `group-by`, `view`, `limit`, `under` and `child-of`.
- **Dataview-style second.** `LIST | TABLE | BOARD ... WHERE ... SORT ... GROUP BY ... LIMIT` parses to the same AST. Text that isn't Logseq syntax is tried as Dataview.
- **Logseq advanced queries** (`#+BEGIN_QUERY`) are translated by pattern. What can't be translated becomes a "convert me" block that keeps the original and says why.
- **Typed AST to SQL.** The AST is an Effect Schema with a fixed set of public fields (`page`, `page.day`, `tag`, `task.status`, `property.x`, `updated`, ...). One file maps fields to tables. `under` compiles to a recursive CTE, and page names also match aliases.
- **`WatchQuery`** parses the text (Logseq syntax, then Dataview), compiles it, works out its read keys, and streams results from the index.

## Packages

| Side   | Packages                                                                                | Job                                                  |
| ------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| shared | `@seqno/domain`, `@seqno/rpc`                                                           | ids, schemas, commands, events; the UI-core contract |
| pure   | `@seqno/syntax`, `@seqno/query`                                                         | markdown parsing, query text to SQL                  |
| core   | `@seqno/graph`, `@seqno/index`, `@seqno/vault`, `@seqno/interop`, `apps/web/src/worker` | everything behind the RPC boundary                   |
| UI     | `apps/web`, `@seqno/outliner`, `@seqno/editor`                                          | what you see and type into                           |
| tools  | `@seqno/sync-sim`, `@seqno/e2e`, `@seqno/lint`                                          | sync simulator, browser flows, lint rules            |

The dependency rule: the UI side imports only shared, pure and other UI packages, and reaches the core only through `@seqno/rpc`. The core never imports UI code. Lint enforces it. The full repo map and rules are in [AGENTS.md](../AGENTS.md).
