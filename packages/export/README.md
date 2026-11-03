# @seqno/export

Logseq's export formats, as pure functions over pages and their blocks.

- `exportBlocks(library, target, format, options)`: a page or some blocks as text, OPML or HTML, with the options of Logseq's "Copy / Export as" dialog (indent style, remove `[[ ]]`, emphasis, `#tags` or properties, newline after block, level <= N). Block refs become their block's text and `{{embed}}` expands in place, five deep, as in Logseq.
- `exportGraph(pages, format, { graph, seconds, path })`: the whole graph as EDN or JSON (the shape Logseq's own importers read, page properties carried by a first empty block as Logseq writes them), Roam JSON, or a zip of one standard Markdown or OPML file per page.

The UI renders PNG itself from the real block view; this package does not draw.

## Test

`pnpm vitest run packages/export`. The e2e flows are in `tools/e2e/flows/export.e2e.ts`.

## Known gaps

- Lists and tables inside a block stay as text in OPML and HTML; Logseq turns lists into child outlines and `<ul>`s.
- Property values are strings; Logseq types `true`, numbers and reference sets.
- Multi-line blocks don't get Logseq's two-space hard breaks in text.
- Logseq's "Export public pages" (a static site, desktop only) isn't built.
