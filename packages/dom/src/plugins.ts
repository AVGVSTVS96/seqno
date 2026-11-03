import { names, type Table } from "./names.ts"

export interface PluginParts {
  readonly "seqno-plugin-frames": readonly [boolean]
  readonly "seqno-plugin-frame": readonly []
  readonly "seqno-plugin-float": readonly []
  readonly "seqno-plugin-slot": readonly []
  readonly "seqno-plugin-float-content": readonly []
  readonly "seqno-plugin-handle": readonly []
  readonly "seqno-plugin-handle-bar": readonly []
  readonly "seqno-plugin-handle-title": readonly []
  readonly "seqno-plugin-handle-actions": readonly []
  readonly "seqno-plugin-handle-close": readonly []
  readonly "seqno-plugin-resize": readonly []
  readonly "seqno-plugin-item": readonly [
    { readonly type: string; readonly key: string; readonly pid: string },
  ]
  readonly "seqno-plugin-menu-item": readonly [
    { readonly type: string; readonly key: string; readonly pid: string },
  ]
  readonly "plugin-toolbar": readonly []
  readonly "plugin-toolbar-list": readonly []
  readonly "plugin-toolbar-trigger": readonly []
  readonly "plugin-toolbar-manager": readonly []
  readonly "plugin-toolbar-button": readonly []
  readonly "plugin-toolbar-entry": readonly []
  readonly "plugin-toolbar-pin": readonly [pinned: boolean]
  readonly "seqno-fenced-code": readonly [active: boolean]
  readonly "seqno-fenced-code-source": readonly []
  readonly "seqno-fenced-code-result": readonly [edit: boolean]
  readonly "seqno-fenced-code-actions": readonly []
  readonly "seqno-fenced-code-action": readonly []
  readonly "plugin-settings-inner": readonly []
  readonly "plugin-setting": readonly [string]
  readonly "plugin-setting-heading-item": readonly []
  readonly "plugin-setting-input": readonly [string]
  readonly "plugin-setting-select": readonly []
  readonly "plugin-setting-choices": readonly [boolean]
  readonly "plugin-setting-choice-input": readonly [boolean]
}

const settingKinds: Readonly<Record<string, string>> = {
  string: "as-input",
  number: "as-input",
  boolean: "as-toggle",
  enum: "as-enum",
  object: "as-object",
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
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/helpers.ts#L382
  "seqno-plugin-float-content": () => ({ className: "ls-ui-float-content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L720
  "seqno-plugin-handle": () => ({ className: "draggable-handle" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L723
  "seqno-plugin-handle-bar": () => ({ className: "th" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L724
  "seqno-plugin-handle-title": () => ({ className: "l" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L725
  "seqno-plugin-handle-actions": () => ({ className: "r" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L726
  "seqno-plugin-handle-close": () => ({ className: "button x" }),
  // https://github.com/logseq/logseq/blob/0.10.9/libs/src/LSPlugin.core.ts#L806
  "seqno-plugin-resize": () => ({ className: "resizable-handle" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L997
  "seqno-plugin-slot": () => ({ className: "lsp-hook-ui-slot" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1009
  "seqno-plugin-item": ({ type, key, pid }) => ({
    className: `injected-ui-item-${type}`,
    id: `injected-ui-item-${key}-${pid}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1006-L1024
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1043
  "seqno-plugin-menu-item": ({ type, key, pid }) => ({
    className: `pl-injected-ui-item-${type}`,
    id: `pl-injected-ui-item-pl-${key}-${pid}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1130-L1131
  "plugin-toolbar": () => ({ className: "ui-items-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1106
  "plugin-toolbar-list": () => ({ className: "list-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L163
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1077
  "plugin-toolbar-trigger": () => ({
    className: "relative ui__dropdown-trigger toolbar-plugins-manager-trigger",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1033
  "plugin-toolbar-manager": () => ({ className: "toolbar-plugins-manager" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1035
  "plugin-toolbar-button": () => ({ className: "button relative" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1043
  "plugin-toolbar-entry": () => ({ className: "flex items-center item-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1046-L1048
  "plugin-toolbar-pin": (pinned) => ({
    className: names("pin flex items-center opacity-60", pinned && "pinned"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3345
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1162
  "seqno-fenced-code": (active) => ({
    className: names("ui-fenced-code-wrap", active && "is-active"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L3164
  "seqno-fenced-code-source": () => ({ className: "ui-fenced-code-editor" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1187
  "seqno-fenced-code-result": (edit) => ({
    className: names("ui-fenced-code-result", !edit && "not-edit"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1192
  "seqno-fenced-code-actions": () => ({ className: "actions" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1194
  "seqno-fenced-code-action": () => ({ className: "ui__button" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins_settings.cljs#L119
  "plugin-settings-inner": () => ({ className: "cp__plugins-settings-inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins_settings.cljs#L31-L86
  "plugin-setting": (type) => ({ className: names("desc-item", settingKinds[type]) }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins_settings.cljs#L97
  "plugin-setting-heading-item": () => ({ className: "heading-item" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins_settings.cljs#L40-L41
  "plugin-setting-input": (inputAs) => ({
    className: names(inputAs !== "color" && inputAs !== "range" && "form-input"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L887
  "plugin-setting-select": () => ({ className: "form-select" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L903-L940
  "plugin-setting-choices": (many) => ({
    className: many ? "ui__checkbox-list" : "ui__radio-list",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L910
  "plugin-setting-choice-input": (many) => ({ className: many ? "form-checkbox" : "form-radio" }),
}
