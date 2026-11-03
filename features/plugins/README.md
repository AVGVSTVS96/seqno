# @seqno/plugins

Runs Logseq marketplace plugins, unchanged, in seqno.

```
plugin iframe (seqno's origin, lsp/…)   seqno tab
  @logseq/libs  ── postMessage ──▶  host.ts      handshake, api:call, provider:*, settings:*, main-ui:*
                ◀── hooks ───────   api.ts       Logseq's App / Editor / DB / UI methods on CoreClient
                                    inject.ts    provideUI / provideStyle, data-on-* clicks
                                    state.ts     installed list, settings, toolbar items, commands, themes
                                    slots.tsx    toolbar items, {{renderer}} slots, the theme stylesheet
                                    marketplace.ts  logseq/marketplace index and the R2 mirror
                                    files.ts     the local copy of each installed plugin's files
                                    datalog.ts   the graph in Logseq's Datascript schema, for datascriptQuery
                                    storage.ts   logseq.FileStorage in the browser's private file system
                                    selection.ts onInputSelectionEnd from the block editor
```

- `startPlugins(registry, bridge)` loads every installed plugin. `apps/web` gives it a `Bridge` (navigation, sidebars, notices, the core) and forwards `route_changed`, `theme_mode_changed`, `current_graph_changed` and `WatchChanges` as hooks. Every tab runs every plugin, so toolbars, slash commands and settings work in each, but `DB.onChanged` reaches only the tab that made the edit; an edit no tab made (another device's, today's journal) goes to the one tab holding the graph's `seqno.plugins.<graph>` Web Lock. A plugin that writes on change writes once.
- The editor takes plugin slash commands through `editorCommands`, the outliner draws `{{renderer …}}` through its `MacroSlot` context, the block menu lists `block-context-menu-item` commands, and the PDF viewer's highlight menu lists `highlight-context-menu-item` commands after Delete, for text highlights, running them with `runHighlightItem`.
- Plugin files load from seqno's own origin: `<base>lsp/<owner>/<repo>/<version>/…` proxies Logseq's R2 mirror (the Vite dev and preview proxy in `apps/web/offline.ts`, a rewrite in `vercel.json`), which sends no CORS headers. Install gathers a copy into the `seqno-plugins` cache (`files.ts`): the entry page and what it references, followed through CSS `url()`/`@import` and JS relative imports, plus the icon and theme stylesheets. `apps/web`'s service worker serves that copy first and keeps anything else a plugin fetches under its root, and any script a plugin frame loads from another origin (a CDN copy of `@logseq/libs`). Install also copies the scripts an entry page names on other sites and the stylesheets and fonts a theme's CSS imports from them (`elsewhereIn`), WOFF2 only where a font offers it. Installs store the mirror URL and `local()` maps it at use, so plugins installed before the copy existed load the same way and get their copy on the next start. Uninstall deletes the copy.
- `logseq.Assets` (`assets.ts`) answers from the graph's `assets/` through the app's `AssetBridge`: `listFilesOfCurrentGraph` lists every file with Logseq's fields, paths written as `<graph>/assets/…`; `makeUrl` gives the file's blob URL for any relative or `<graph>/` form of its path; `builtInOpen` opens PDFs in seqno's viewer and returns `false` for anything else; `makeSandboxStorage` keeps a plugin's items in `assets/storages/<id>/`, so they travel with the graph. Its six storage calls are the ones `logseq.FileStorage` makes without the assets flag; those go to `storage.ts`, which keeps each plugin's files in the browser's origin private file system under `plugin-storages/<id>/`, outside every graph, as Logseq desktop keeps them in `~/.logseq/storages/<id>`.
- `DB.datascriptQuery` runs on Datascript (`datalog.ts`), the engine Logseq queries with, over a copy of the graph in Logseq 0.10.9's file-graph schema. The copy is built from `ExportPages` the first time a plugin queries and follows `WatchChanges` a page at a time. Inputs resolve as Logseq's (`inputs.ts`): strings are read as EDN, keyword inputs such as `:today`, `:-7d`, `:current-page` and `:current-block` become their values, and `"[[page]]"` becomes the page's name.
- `insertBlock` with `customUUID` writes that uuid as the block's `id::`, so `getBlock`, `((refs))` and Datalog's `:block/uuid` reach it; a uuid already in use throws Logseq's "Custom block UUID already exists". Blocks with an `id::` answer with it as their `uuid`, as in Logseq.
- Selecting text in a block fires `onInputSelectionEnd` with Logseq's payload, its `point` where the mouse let go (or the selection's end for keyboard selections). A `provideUI` with no slot or path floats at the `left`/`top` it asks for.
- Commands registered with `palette` (`registerCommandPalette`, `registerCommand` with `palette: true`) are in the command palette (Mod+Shift+P, and in search), with their keybinding; `page-menu-item` commands are in the page menu (the header's `…` and a right-click on the page title) and get `{ page }`. Keybindings may be chords (`r n`, `ctrl+m ctrl+m`); ones without a modifier don't fire while typing in a text box.
- An API method seqno lacks throws "seqno doesn't support logseq … yet", which the plugin receives as a rejected call.

## Testing

`pnpm vitest run` here covers the protocol's names, package parsing and the block and page shapes. `test/datalog.test.ts` runs Datalog against a built graph and checks Logseq's input keywords. `tools/e2e/flows/plugins.e2e.ts` runs five real plugins from `fixtures/logseq-plugins` in Chrome, `tools/e2e/flows/plugins-assets.e2e.ts` runs Assets plus on a graph's assets, `tools/e2e/flows/plugins-pdf.e2e.ts` runs PDF Translator's highlight menu item on a selection in the PDF viewer, and `tools/e2e/flows/plugins-api.e2e.ts` runs Word count's selection count, Quick Capture (`:today` and EDN string inputs), Log-Stats (`not`, `contains?`, `re-find`, after edits), Hypothesis (file storage across a reload) and `customUUID`. `tools/e2e/flows/themes.e2e.ts` checks that real marketplace themes restyle seqno through Logseq's class names, which seqno's elements carry (decisions.md, "seqno's elements carry Logseq's names").

## Known gaps

- A plugin's display in one tab doesn't follow `DB.onChanged` for edits made in another tab.
- A plugin installed in a browser without the Cache API (an `http://` address other than localhost) loads from the mirror and doesn't work offline.
- Not supported yet: Git, `Experiments`, and `datascriptQuery` inputs that are functions (Logseq takes those only through the host's own window).
- The Datalog copy has no pre-blocks (page properties are on the page entity), no `:block/created-at` or `:block/updated-at`, and no `:block/refs` to blocks that don't exist.
