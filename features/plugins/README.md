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
```

- `startPlugins(registry, bridge)` loads every installed plugin. `apps/web` gives it a `Bridge` (navigation, sidebars, notices, the core) and forwards `route_changed`, `theme_mode_changed`, `current_graph_changed` and `WatchChanges` as hooks.
- The editor takes plugin slash commands through `editorCommands`, the outliner draws `{{renderer …}}` through its `MacroSlot` context, and the block menu lists `block-context-menu-item` commands.
- `logseq.Assets` (`assets.ts`) answers from the graph's `assets/` through the app's `AssetBridge`: `listFilesOfCurrentGraph` lists every file with Logseq's fields, paths written as `<graph>/assets/…`; `makeUrl` gives the file's blob URL for any relative or `<graph>/` form of its path; `builtInOpen` opens PDFs in seqno's viewer and returns `false` for anything else; `makeSandboxStorage` keeps a plugin's items in `assets/storages/<id>/`, so they travel with the graph. Its six storage calls are the ones `logseq.FileStorage` makes without the assets flag, which still answers "not supported yet".
- Plugin files load from seqno's own origin: `<base>lsp/<owner>/<repo>/<version>/…` proxies Logseq's R2 mirror (the Vite dev and preview proxy in `apps/web/offline.ts`, a rewrite in `vercel.json`), which sends no CORS headers. Install gathers a copy into the `seqno-plugins` cache (`files.ts`): the entry page and what it references, followed through CSS `url()`/`@import` and JS relative imports, plus the icon and theme stylesheets. `apps/web`'s service worker serves that copy first and keeps anything else a plugin fetches under its root. Installs store the mirror URL and `local()` maps it at use, so plugins installed before the copy existed load the same way and get their copy on the next start. Uninstall deletes the copy.
- An API method seqno lacks throws "seqno doesn't support logseq … yet", which the plugin receives as a rejected call.

## Testing

`pnpm vitest run` here covers the protocol's names, package parsing and the block and page shapes. `tools/e2e/flows/plugins.e2e.ts` runs five real plugins from `fixtures/logseq-plugins` in Chrome, and `tools/e2e/flows/plugins-assets.e2e.ts` runs Assets plus on a graph's assets. `tools/e2e/flows/themes.e2e.ts` checks that real marketplace themes restyle seqno through Logseq's class names, which seqno's elements carry (decisions.md, "seqno's elements carry Logseq's names").

## Known gaps

- Each tab runs its own copy.
- A plugin installed in a browser without the Cache API (an `http://` address other than localhost) loads from the mirror and doesn't work offline.
- Not placed yet: page and highlight menu items, the command palette.
- Not supported yet: `datascriptQuery` inputs, `customUUID`, Git, file storage, `Experiments`.
