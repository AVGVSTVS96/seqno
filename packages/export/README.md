# @seqno/export

Logseq's export formats, as pure functions over pages and their blocks.

- `exportBlocks(library, target, format, options)`: a page or some blocks as text, OPML or HTML, with the options of Logseq's "Copy / Export as" dialog (indent style, remove `[[ ]]`, emphasis, `#tags` or properties, newline after block, level <= N). Block refs become their block's text and `{{embed}}` expands in place, five deep, as in Logseq.
- `exportGraph(pages, format, { graph, seconds, path })`: the whole graph as EDN or JSON (the shape Logseq's own importers read, page properties carried by a first empty block as Logseq writes them), Roam JSON, or a zip of one standard Markdown or OPML file per page.

- `publicPages(pages, allPublic)`, `usedAssets`, `queriesIn`, `namesLinked` and `publicSite(data, viewer, style, assets)`: Logseq's "Export public pages". They pick the pages (`public:: true` and aliases, or all but `public:: false` when `allPagesPublic(config.edn)`), find the assets and queries they use, and lay out the site folder (`index.html` with the `Published` JSON, `404.html`, `static/`, `assets/`); `zipSite` zips it. The viewer script itself is built in `apps/web` (`viewer.ts`, `src/publish`).

The UI renders PNG itself from the real block view; this package does not draw.

## Test

`pnpm vitest run packages/export`. The e2e flows are in `tools/e2e/flows/export.e2e.ts`.

## Like Logseq, and where it isn't

Every format matches Logseq 0.10.9's output for the same graph; `docs/decisions.md` lists where seqno keeps text Logseq's output loses (quote continuations, footnote carets, repeater `+`, logbooks and `#+BEGIN` blocks, macro arguments, unresolved refs) and where OPML and HTML write single spaces instead of Logseq's stray ones.

## Known gaps

- Property values are typed with Logseq's default config; `:property/separated-by-commas` and `:ignored-page-references-keywords` from a graph's `config.edn` aren't read.
- A ref to a block on another page that still has its Logseq-era (non-v7) `id::` isn't loaded for Export page, so it stays `((uuid))`; the outliner can't show those refs either.
- The public site is seqno's own viewer, not Logseq's bundle (see `docs/decisions.md`); its queries are frozen at export time.
