# @seqno/syntax — phase 1 results

Logseq OG markdown <-> block tree. Pure TypeScript, Effect Schema for every output type. No dependency on `@seqno/domain`.

## Two layers

```
source ──parse──▶ Document (lossless CST) ──toOutline──▶ Outline (blocks with text)
source ◀──print── Document                  Outline ──render──▶ source (canonical Logseq layout)
                                            text ──analyzeBlock──▶ BlockSyntax (props, refs, task…)
```

| API | job | guarantee |
|---|---|---|
| `parse(source): Document` / `print(doc): string` | raw block tree: per node its raw `indent`, raw `lines`, `children`; `preamble` is the verbatim text before the first bullet | `print(parse(s)) === s` for **every** string (fast-check, 3000 runs incl. binary strings, CRLF, BOM, stray `\r`, fences) |
| `toOutline(doc): Outline` / `render(outline): string` | graph-facing tree: `Block { text, children }` + `preamble` + `Format { indent, eol, finalNewline, bom }` | `toOutline(parse(render(o)))` deep-equals `o`, and `render(toOutline(parse(s))) === s` for Logseq-written files (tabs, 2/4 spaces, CRLF, BOM, final newline). fast-check, 2000 runs |
| `analyzeBlock(text): BlockSyntax` | marker (TODO/DOING/DONE/LATER/NOW/WAITING/WAIT/CANCELED/CANCELLED/IN-PROGRESS/STARTED), `[#A]` priority, heading level, properties (ordered + `props` record), `id::` uuid, `collapsed::`, SCHEDULED/DEADLINE with time and `+ ++ .+` repeaters, refs (`[[page]]` incl. nested, `#tag`, `#[[tag]]`, `((uuid))`, `tags::`/`alias::` comma lists), macros (`{{embed …}}`, `{{query …}}`), regions (code fences, `#+BEGIN_X` directives, `:LOGBOOK:` drawers), all with spans into the text | refs inside code, fences, `#+BEGIN_QUERY/SRC/EXAMPLE/EXPORT/COMMENT` and `{{query}}` are ignored |
| `setProperty(text, key, value \| null): TextEdit \| null` + `applyEdit` | minimal `{ from, to, insert }` edit (same shape as the `EditText` command) to add/replace/remove a `key:: value` line | set-then-clear restores the text (fast-check) |

Block `text` is the block's full markdown source with bullet and continuation indentation removed, **including** its property lines, planning lines and LOGBOOK. Props, id and collapsed are derived from it, so the text stays the single source of truth and the mirror writer reproduces files exactly.

Parsing rules worth knowing:
- Only `-` bullets start blocks. Nesting is by indentation width (tab stop 4), so mixed tabs/spaces still nest sensibly.
- Inside an open code fence or `#+BEGIN_…` block, bullet lines deeper than the owning block are content; a bullet at the owner's depth or shallower closes it (an unclosed fence never eats sibling blocks).
- YAML front matter (`---` … `---`) at the top is preamble, so its `- item` lists are not blocks.
- Continuation lines lose the canonical `indent + "  "` prefix (or as much of it as is present); blank continuation lines render back as `indent + "  "`, matching Logseq's writer.

## Run

```
cd packages/syntax
pnpm install            # standalone for now; uses the shared store
pnpm test               # 17 tests, ~1.5 s
pnpm typecheck
```

## Known gaps / for integration

- **Contract additions** (all inside this package): `Document`, `Node`, `Outline`, `Block` (syntax-level `{ text, children }`, not the domain `Block`), `Format`, `BlockSyntax`, `Ref`, `Macro`, `Region`, `Timestamp`, `Repeater`, `Property`, `Span`, `TextEdit`. Block ids come back as lowercase UUID strings; the domain should brand them.
- **Page properties**: the preamble is returned verbatim; call `analyzeBlock(outline.preamble)` for page props (works for `key:: value` lines). YAML front matter keys (`title: x`) are not parsed into props yet.
- **Bullet-less files** (plain markdown, top-level `# Heading` blocks without `-`) land entirely in the preamble. Logseq splits top-level headings into blocks; not done here.
- **Not representable in the canonical layout** (inherent to the format, same in Logseq): a block whose continuation line starts with `- ` outside a fence becomes a child on re-read; an unclosed fence absorbs the block's own children; hand-edited files with irregular indentation, mixed line endings or blank lines without the continuation prefix are normalized by `render` (the lossless `print` still keeps them byte-exact).
- Org-mode files, `:PROPERTIES:` drawer semantics, `$$` math blocks and the `og_import_graph_cases.md` import-repair cases (missing/duplicated block ids, legacy journal file-name refs) belong to `@seqno/interop`; this package exposes the refs and ids those repairs need.
- No `package.json` workspace wiring, lockfile, oxlint or oxfmt run: the root scaffold did not exist in this worktree. Installed standalone with `pnpm install --ignore-workspace`; the lockfile is not committed.
