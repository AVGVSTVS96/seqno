# @seqno/pdf

Logseq's PDF viewer with highlights, as Logseq 0.10.9's desktop app has it. Clicking a `![x.pdf](../assets/x.pdf)` link opens the PDF in a pane on the left (pdf.js `PDFViewer`), where selected text or a dragged-out area becomes a highlight with one of Logseq's five colors. Each highlight lives in two Logseq files: `assets/<key>.edn` (written with fipp's layout, byte for byte) and an annotation block on the page `hls__<key>`.

- `model.ts`: Logseq's pure rules. `inflateAsset` (the key, identity and `.edn` path of a link), `sanitizeFilename`, `displayName`, the `hls__` page and annotation block properties in Logseq's order, Logseq's selection text cleanup, its rect merging and its zoom steps.
- `highlights.ts`: the `.edn` file. `readHighlights` reads it through `@seqno/syntax`'s EDN reader and a Schema; `printHighlights` writes it with `printFipp`.
- `annotations.ts`: the `hls__` page and its blocks as seqno commands through `CoreClient`, one at a time.
- `open.ts`: `openPdf(registry, files, path)` loads pdf.js, the document and the highlights; `openAnnotation(registry, files, block)` opens the PDF at an annotation block's highlight.
- `session.ts`: one open document. It owns the pdf.js viewer, the highlight list and its 4-second save, the menu, area drags and resizes, area pictures, find, and the `alt+p`, `alt+n`, `alt+x`, `alt+f` keys.
- `PdfPane.tsx`, `Toolbar.tsx`, `Regions.tsx`: the pane, Logseq's toolbar and popups, and the highlight layers drawn into pdf.js's text layers.

`apps/web` mounts `PdfPane` with a `PdfHost` (asset reads and writes, notices, navigation and plugins' highlight menu items), and serves pdf.js's `cmaps/`, `standard_fonts/`, `wasm/` and `iccs/` under `pdfjs/` (`apps/web/pdfjs.ts`). The outliner draws annotation blocks and refs to them (the `P<n>` prefix, area pictures) in `features/outliner/src/Annotation.tsx`.

## Testing

`pnpm vitest run features/pdf` covers the pure rules and the `.edn` file against one Logseq made (`fixtures/graphs/pdf-highlights`). `tools/e2e/flows/pdf.e2e.ts` opens that graph in Chrome and makes, changes and deletes highlights.

## Known gaps

- Logseq's separate PDF window is Electron-only, so its toolbar button is left out.
- Maximize on an area picture shows that picture alone; Logseq's lightbox steps through every area picture on the page.
- The hls page is always Markdown, whatever the graph's preferred format.
