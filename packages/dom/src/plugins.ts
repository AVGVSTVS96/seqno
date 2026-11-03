import { names, type Table } from "./names.ts"

export interface PluginParts {
  readonly "seqno-plugin-frames": readonly [boolean]
  readonly "seqno-plugin-frame": readonly []
  readonly "seqno-plugin-float": readonly []
  readonly "seqno-plugin-slot": readonly []
  readonly "seqno-plugin-item": readonly [
    { readonly type: string; readonly key: string; readonly pid: string },
  ]
}

export const pluginParts: Table<PluginParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.caller.ts#L234
  "seqno-plugin-frames": (visible) => ({
    className: names("lsp-iframe-sandbox-container", visible && "visible"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/helpers.ts#L251
  "seqno-plugin-frame": () => ({ className: "lsp-iframe-sandbox" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/helpers.ts#L410
  "seqno-plugin-float": () => ({ className: "lsp-ui-float-container visible" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L997
  "seqno-plugin-slot": () => ({ className: "lsp-hook-ui-slot" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1009
  "seqno-plugin-item": ({ type, key, pid }) => ({
    className: `injected-ui-item-${type}`,
    id: `injected-ui-item-${key}-${pid}`,
  }),
}
