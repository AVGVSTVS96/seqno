# seqno

A TypeScript rebuild of Logseq: a local-first outliner, web first (Chrome and Edge), then iOS and desktop. The truth is a Loro CRDT edit log; SQLite is a rebuildable index. How it fits together: `docs/architecture.md`; why: `docs/decisions.md`.

`pnpm check` is the gate (lefthook runs `pnpm check:fast` before each commit, CI runs `pnpm check` on Node 24 and 26). `pnpm fix` lints and formats with fixes. `pnpm --filter @seqno/web dev` runs the app, `pnpm build` builds the site with the app at `/app`, as Vercel serves it.

## Map

| Folder | Side | Job |
| --- | --- | --- |
| `packages/domain` | domain | Schemas, branded ids, Command and GraphEvent unions |
| `packages/rpc` | contract | UI ↔ core-worker contract (Effect RPC) |
| `packages/{syntax,query,export,dom}` | pure | Logseq markdown, queries, export formats, Logseq's DOM names |
| `packages/{graph,index,vault,interop,git}` | core | Loro graph, SQLite index, edit-log files, Logseq import and mirror, git |
| `apps/web` | ui | The app; `apps/web/src/worker/**` is the core worker (core side) |
| `apps/site` | ui | The homepage, served at `/` with the app at `/app` |
| `features/*` | ui | Outliner, editor, plugins, whiteboard, pdf |
| `tools/*`, `fixtures/` | tool | sync-sim, e2e and design capture, lint plugin, benches, test graphs |
| `brand/` | | Logo, fonts, og image, copy |

```
                 domain   <- imports no @seqno package
                    ^
                 contract (rpc)   <- domain only
                 ^          ^
   ui side ------+          +------ core side
   apps/*, features/*               pure (domain + pure), core, worker
   (domain, rpc, pure, ui)          (never ui)
   tools/* may import anything; nothing imports a tool
```

The UI reaches the core only through `@seqno/rpc`, and starts the worker with `new SharedWorker(new URL(...))`, never an import.

## What enforces each rule

| Rule | Enforced by |
| --- | --- |
| The side rules above | `no-restricted-imports` overrides in `oxlint.config.ts`, tested in `tools/lint/test/config.test.ts` |
| Undeclared packages can't be imported | pnpm's strict `node_modules` |
| Relative imports stay inside their package | `rootDir: "."` in each package's `tsconfig.json` |
| No comments, except an https:// link, a `SAFETY:` line, or a lint directive with its reason after `--` | `no-comments/no-comments` |
| No `useEffect` family | `no-restricted-imports` (react) |
| No `as` (only `as const`), no `any`, no `!` | `typescript/consistent-type-assertions` (never), `no-explicit-any`, `no-non-null-assertion` |
| Logseq's names come only from `@seqno/dom` | `seqno/logseq-names` |
| Strict types, erasable syntax only | `tsconfig.base.json` |
| The rest of the house style | Ultracite core, react, vitest and anti-slop presets, anti-slop's Effect rules |

## Judgment calls

- pnpm, not bun: the tests run on Vitest, the outliner's in Vitest browser mode in real Chrome, and CI runs them on Node 24 and 26.
- `loro-crdt` stays at exactly 1.16.4 and KaTeX at 0.16.10: the iOS build reads the same Loro bytes, and Logseq 0.10.9 ships that KaTeX, which plugins extend.
- Effect 4 differs from what models remember: `Context.Service`, `Result`, Schema v4 names. Check the installed types and https://github.com/Effect-TS/effect/blob/main/MIGRATION.md.
- Domain data is plain readonly `_tag` unions matched exhaustively; they cross to the worker by structured clone.
- Tests call code the way users do and compare against literal values.
- e2e, bench and sync-sim runs take turns on a machine through `scripts/turn`; run the flows your change touches and leave the rest to CI.
