# @seqno/plugins

Runs Logseq marketplace plugins, unchanged, in seqno.

```
plugin iframe (its own origin)          seqno tab
  @logseq/libs  ── postMessage ──▶  host.ts      handshake, api:call, provider:*, settings:*, main-ui:*
                ◀── hooks ───────   api.ts       Logseq's App / Editor / DB / UI methods on CoreClient
                                    inject.ts    provideUI / provideStyle, data-on-* clicks
                                    state.ts     installed list, settings, toolbar items, commands, themes
                                    slots.tsx    toolbar items, {{renderer}} slots, the theme stylesheet
                                    marketplace.ts  logseq/marketplace index and the R2 mirror
```

- `startPlugins(registry, bridge)` loads every installed plugin. `apps/web` gives it a `Bridge` (navigation, sidebars, notices, the core) and forwards `route_changed`, `theme_mode_changed`, `current_graph_changed` and `WatchChanges` as hooks.
- The editor takes plugin slash commands through `editorCommands`, the outliner draws `{{renderer …}}` through its `MacroSlot` context, and the block menu lists `block-context-menu-item` commands.
- An API method seqno lacks throws "seqno doesn't support logseq … yet", which the plugin receives as a rejected call.

## Testing

`pnpm vitest run` here covers the protocol's names, package parsing and the block and page shapes. `tools/e2e/flows/plugins.e2e.ts` runs five real plugins from `fixtures/logseq-plugins` in Chrome.

## Known gaps

- Plugins load from the network; each tab runs its own copy.
- `effect` (desktop-only) plugins are hidden, as on Logseq's web build.
- Not placed yet: page and highlight menu items, the command palette.
- Not supported yet: `datascriptQuery` inputs, `customUUID`, Git, assets, file storage, `Experiments`.
