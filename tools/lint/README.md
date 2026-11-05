# @seqno/lint

The repo's own oxlint plugins, which the root `oxlint.config.ts` loads.

| File                  | What it does                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/no-comments.ts`  | Bans comments except an https:// link, a `SAFETY:` line or a lint directive with its reason. The same file in every one of Bassim's repos. |
| `src/logseq-names.ts` | `seqno/logseq-names`: Logseq's class names, ids and attributes come only from `@seqno/dom`.                                                |
| `anti-slop-effect/`   | dmmulroy/anti-slop's Effect rules, vendored unchanged at 13909c9 (MIT).                                                                    |
| `test/config.test.ts` | Lints probe files with the root config to prove the side rules, the `useEffect` ban and the `any`/`as` bans still fire.                    |

```sh
pnpm exec vitest run --project @seqno/lint
```
