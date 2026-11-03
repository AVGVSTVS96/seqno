import { names, type Table } from "./names.ts"

type Flag = readonly [boolean]
type Color = readonly [string | undefined]

export interface PdfParts {
  readonly "seqno-pdf": readonly [{ readonly identity: string; readonly theme: string }]
  readonly "seqno-pdf-open": readonly []
  readonly "seqno-pdf-resizing": readonly []
  readonly "seqno-pdf-loader": readonly []
  readonly "seqno-pdf-scroller": readonly []
  readonly "seqno-pdf-viewer": Flag
  readonly "seqno-pdf-picking": readonly []
  readonly "seqno-pdf-holder": readonly []
  readonly "seqno-pdf-area-selection": readonly []
  readonly "seqno-pdf-shadow-rect": readonly []
  readonly "seqno-pdf-resizer": readonly []
  readonly "seqno-pdf-menu": readonly []
  readonly "seqno-pdf-menu-colors": readonly []
  readonly "seqno-pdf-menu-color": Color
  readonly "seqno-pdf-item": readonly []
  readonly "seqno-pdf-highlights-layer": readonly []
  readonly "seqno-pdf-regions": readonly []
  readonly "seqno-pdf-text-region": readonly [string]
  readonly "seqno-pdf-text-region-item": Color
  readonly "seqno-pdf-area-region": readonly [string, string | undefined]
  readonly "seqno-pdf-flash": readonly []
  readonly "seqno-pdf-header": readonly []
  readonly "seqno-pdf-toolbar": readonly []
  readonly "seqno-pdf-inner": readonly []
  readonly "seqno-pdf-buttons": readonly []
  readonly "seqno-pdf-button": Flag
  readonly "seqno-pdf-pager": readonly []
  readonly "seqno-pdf-page-number": readonly []
  readonly "seqno-pdf-page-input": Flag
  readonly "seqno-pdf-page-buttons": readonly []
  readonly "seqno-pdf-settings": readonly []
  readonly "seqno-pdf-settings-inner": readonly []
  readonly "seqno-pdf-theme-picker": readonly []
  readonly "seqno-pdf-theme": readonly [string]
  readonly "seqno-pdf-toggle": Flag
  readonly "seqno-pdf-switch": Flag
  readonly "seqno-pdf-metadata-link": readonly []
  readonly "seqno-pdf-docinfo": readonly []
  readonly "seqno-pdf-inner-text": readonly []
  readonly "seqno-pdf-finder-wrap": readonly []
  readonly "seqno-pdf-finder": readonly []
  readonly "seqno-pdf-find-input-inner": readonly []
  readonly "seqno-pdf-find-input": readonly []
  readonly "seqno-pdf-enter-icon": readonly []
  readonly "seqno-pdf-case": Flag
  readonly "seqno-pdf-find-result": readonly []
  readonly "seqno-pdf-not-found": readonly []
  readonly "seqno-pdf-outline-wrap": Flag
  readonly "seqno-pdf-outline": readonly []
  readonly "seqno-pdf-outline-tabs": readonly []
  readonly "seqno-pdf-outline-tab": Flag
  readonly "seqno-pdf-outline-panels": readonly []
  readonly "seqno-pdf-outline-empty": readonly []
  readonly "seqno-pdf-outline-item": readonly [
    { readonly parent: boolean; readonly expanded: boolean },
  ]
  readonly "seqno-pdf-arrow": readonly []
  readonly "seqno-pdf-children": readonly []
  readonly "seqno-pdf-highlights-item": Flag
  readonly "seqno-pdf-highlights-color": Color
  readonly "seqno-pdf-area-wrap": readonly []
  readonly "seqno-pdf-text-wrap": readonly []
  readonly "seqno-annotation": readonly [{ readonly color: string | undefined }]
  readonly "seqno-annotation-title": readonly [{ readonly area: boolean }]
  readonly "seqno-annotation-ref": readonly [{ readonly area: boolean }]
  readonly "seqno-annotation-prefix": readonly []
  readonly "seqno-annotation-page": readonly []
  readonly "seqno-annotation-page-number": readonly []
  readonly "seqno-annotation-blank": readonly []
  readonly "seqno-annotation-area": readonly []
  readonly "seqno-annotation-area-actions": readonly []
  readonly "seqno-annotation-area-button": readonly []
  readonly "seqno-hl-colored": readonly []
}

const colored = (color: string | undefined) =>
  color === undefined || color.trim() === "" ? {} : { "data-color": color }

export const pdfParts: Table<PdfParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L1030-L1031
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L466-L467
  "seqno-pdf": ({ identity, theme }) => ({
    className: "extensions__pdf-container",
    id: `pdf-layout-container_${identity}`,
    "data-theme": theme,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L1040
  "seqno-pdf-open": () => ({ className: "is-pdf-active" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L100
  "seqno-pdf-resizing": () => ({ className: "is-resizing-buf" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L984
  "seqno-pdf-loader": () => ({ className: "extensions__pdf-loader" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L811
  "seqno-pdf-scroller": () => ({ className: "extensions__pdf-viewer-cnt visible-scrollbar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L812-L813
  "seqno-pdf-viewer": (dashed) => ({
    className: names("extensions__pdf-viewer overflow-x-auto", dashed && "is-area-dashed"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L461
  "seqno-pdf-picking": () => ({ className: "disabled-text-selection" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L815
  "seqno-pdf-holder": () => ({ className: "pp-holder" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L532
  "seqno-pdf-area-selection": () => ({ className: "extensions__pdf-area-selection" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L535
  "seqno-pdf-shadow-rect": () => ({ className: "shadow-rect" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L104
  "seqno-pdf-resizer": () => ({ className: "extensions__pdf-resizer" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L194
  "seqno-pdf-menu": () => ({ className: "extensions__pdf-hls-ctx-menu" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L204
  "seqno-pdf-menu-colors": () => ({ className: "item-colors" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L206
  "seqno-pdf-menu-color": (color) => ({ className: "", ...colored(color) }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L209-L220
  "seqno-pdf-item": () => ({ className: "item" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/utils.cljs#L60
  "seqno-pdf-highlights-layer": () => ({ className: "extensions__pdf-hls-layer" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L387
  "seqno-pdf-regions": () => ({ className: "hls-region-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L253-L254
  "seqno-pdf-text-region": (id) => ({
    className: "extensions__pdf-hls-text-region",
    id: `hl_${id}`,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L260-L265
  "seqno-pdf-text-region-item": (color) => ({
    className: "hls-text-region-item",
    ...colored(color),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/core.cljs#L373-L376
  "seqno-pdf-area-region": (id, color) => ({
    className: "extensions__pdf-hls-area-region",
    id: `hl_${id}`,
    ...colored(color),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/utils.js#L126-L129
  "seqno-pdf-flash": () => ({ className: "hl-flash" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L501
  "seqno-pdf-header": () => ({ className: "extensions__pdf-header" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L502
  "seqno-pdf-toolbar": () => ({ className: "extensions__pdf-toolbar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L503
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L292
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L437
  "seqno-pdf-inner": () => ({ className: "inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L504
  "seqno-pdf-buttons": () => ({ className: "r flex buttons" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L507-L521
  "seqno-pdf-button": (active) => ({ className: names("button", active && "is-active") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L566
  "seqno-pdf-pager": () => ({ className: "pager flex items-center ml-1" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L568
  "seqno-pdf-page-number": () => ({ className: "nu flex items-center opacity-70" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L573
  "seqno-pdf-page-input": (long) => ({ className: names(long && "is-long") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L585
  "seqno-pdf-page-buttons": () => ({ className: "ct flex items-center" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L77
  "seqno-pdf-settings": () => ({ className: "extensions__pdf-settings hls-popup-overlay visible" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L78
  "seqno-pdf-settings-inner": () => ({ className: "extensions__pdf-settings-inner hls-popup-box" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L82
  "seqno-pdf-theme-picker": () => ({ className: "extensions__pdf-settings-item theme-picker" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L84-L85
  "seqno-pdf-theme": (theme) => ({ className: `flex items-center justify-center ${theme}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L88-L100
  "seqno-pdf-toggle": (between) => ({
    className: names("extensions__pdf-settings-item toggle-input", between && "is-between"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L567-L571
  "seqno-pdf-switch": (on) => ({
    className: names("ui__toggle", on ? "ui__toggle-background-on" : "ui__toggle-background-off"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L101
  "seqno-pdf-metadata-link": () => ({ className: "is-info w-full text-gray-500" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L112
  "seqno-pdf-docinfo": () => ({ className: "extensions__pdf-doc-info", id: "pdf-docinfo" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L113
  "seqno-pdf-inner-text": () => ({ className: "inner-text" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L209
  "seqno-pdf-finder-wrap": () => ({
    className: "extensions__pdf-finder-wrap hls-popup-overlay visible",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L212
  "seqno-pdf-finder": () => ({ className: "extensions__pdf-finder hls-popup-box" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L216
  "seqno-pdf-find-input-inner": () => ({ className: "input-inner flex items-center" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L217
  "seqno-pdf-find-input": () => ({ className: "input-wrap relative" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L250
  "seqno-pdf-enter-icon": () => ({ className: "icon-enter" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L255
  "seqno-pdf-case": (active) => ({ className: names(active && "active") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L272
  "seqno-pdf-find-result": () => ({ className: "result-inner" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L281
  "seqno-pdf-not-found": () => ({ className: "px-3 py-3 text-xs opacity-80 text-red-600" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L429-L430
  "seqno-pdf-outline-wrap": (visible) => ({
    className: names("extensions__pdf-outline-wrap hls-popup-overlay", visible && "visible"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L432
  "seqno-pdf-outline": () => ({ className: "extensions__pdf-outline hls-popup-box" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L436
  "seqno-pdf-outline-tabs": () => ({ className: "extensions__pdf-outline-tabs" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L438-L440
  "seqno-pdf-outline-tab": (active) => ({ className: names(active && "active") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L443
  "seqno-pdf-outline-panels": () => ({ className: "extensions__pdf-outline-panels" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L369
  "seqno-pdf-outline-empty": () => ({ className: "is-empty" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L290-L291
  "seqno-pdf-outline-item": ({ parent, expanded }) => ({
    className: names(
      "extensions__pdf-outline-item",
      parent && "has-children",
      expanded && "is-expand",
    ),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L305
  "seqno-pdf-arrow": () => ({ className: "arrow" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L310
  "seqno-pdf-children": () => ({ className: "children" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L382-L384
  "seqno-pdf-highlights-item": (active) => ({
    className: names("extensions__pdf-highlights-list-item", active && "active"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L391
  "seqno-pdf-highlights-color": (color) => ({ className: "", ...colored(color) }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L404
  "seqno-pdf-area-wrap": () => ({ className: "area-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/toolbar.cljs#L406
  "seqno-pdf-text-wrap": () => ({ className: "text-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L2308-L2314
  "seqno-annotation": ({ color }) => ({
    className: "",
    "data-type": "annotation",
    ...(color === undefined || color.trim() === "" ? {} : { "data-hl-color": color }),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1963
  "seqno-annotation-title": ({ area }) => ({
    className: "",
    "data-hl-type": area ? "area" : undefined,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L887-L889
  "seqno-annotation-ref": ({ area }) => ({
    className: "block-ref-wrap inline",
    "data-type": "annotation",
    "data-hl-type": area ? "area" : undefined,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1980
  "seqno-annotation-prefix": () => ({ className: "prefix-link" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1995
  "seqno-annotation-page": () => ({ className: "hl-page" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1996
  "seqno-annotation-page-number": () => ({ className: "forbid-edit" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1997
  "seqno-annotation-blank": () => ({ className: "blank" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/assets.cljs#L278
  "seqno-annotation-area": () => ({ className: "hl-area" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/assets.cljs#L279
  "seqno-annotation-area-actions": () => ({ className: "actions" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/assets.cljs#L281
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/extensions/pdf/assets.cljs#L291
  "seqno-annotation-area-button": () => ({ className: "asset-action-btn px-1" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L942
  "seqno-hl-colored": () => ({ className: "ls-hl-colored" }),
}
