import { names, type Table } from "./names.ts"

export interface Layout {
  readonly leftOpen: boolean
  readonly rightOpen: boolean
  readonly wide: boolean
}

export type SidebarItemType =
  | "contents"
  | "page"
  | "block"
  | "help"
  | "page-graph"
  | "page-slide-view"

export interface ShellParts {
  readonly "seqno-arrow": readonly [boolean]
  readonly "seqno-theme-container": readonly []
  readonly "seqno-theme-inner": readonly [Layout]
  readonly app: readonly []
  readonly "left-container": readonly []
  readonly "main-container": readonly []
  readonly "main-content-container": readonly []
  readonly "main-content": readonly []
  readonly head: readonly []
  readonly "head-left": readonly []
  readonly "head-right": readonly []
  readonly "seqno-left-menu": readonly []
  readonly "seqno-search-button": readonly []
  readonly "seqno-home-button": readonly []
  readonly "seqno-more-button": readonly []
  readonly "seqno-right-toggle": readonly []
  readonly "left-sidebar": readonly []
  readonly "left-sidebar-inner": readonly []
  readonly "left-sidebar-resizer": readonly []
  readonly "left-sidebar-wrap": readonly []
  readonly "left-sidebar-contents": readonly []
  readonly "sidebar-group": readonly [{ readonly group: string | null; readonly expanded: boolean }]
  readonly "sidebar-group-header": readonly [boolean]
  readonly "seqno-sidebar-group-body": readonly []
  readonly "nav-item": readonly []
  readonly "seqno-nav-active": readonly []
  readonly "page-link": readonly [{ readonly kind: "favorite" | "recent"; readonly name: string }]
  readonly "page-link-icon": readonly []
  readonly "page-link-title": readonly []
  readonly "graph-switcher": readonly []
  readonly "graph-name": readonly []
  readonly "right-sidebar": readonly []
  readonly "right-sidebar-inner": readonly []
  readonly "right-sidebar-topbar": readonly []
  readonly "right-sidebar-resizer": readonly []
  readonly "sidebar-tab": readonly []
  readonly "sidebar-item-list": readonly []
  readonly "sidebar-item": readonly [SidebarItemType]
  readonly "sidebar-item-header": readonly []
  readonly "sidebar-item-actions": readonly []
  readonly "sidebar-item-action": readonly []
  readonly "help-button": readonly []
  readonly menu: readonly []
  readonly "menu-item": readonly []
  readonly "menu-separator": readonly []
  readonly "menu-item-label": readonly []
  readonly tooltip: readonly []
  readonly "tooltip-label": readonly []
  readonly dialog: readonly []
  readonly "block-menu": readonly []
  readonly "block-menu-color": readonly [boolean]
  readonly "block-menu-heading": readonly []
  readonly settings: readonly []
  readonly "plugins-dialog": readonly []
  readonly "plugins-tabs": readonly []
  readonly "plugin-card": readonly []
  readonly "plugin-themes": readonly []
}

export const shellParts: Table<ShellParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L762-L765
  "seqno-arrow": (folded) => ({
    className: folded ? "rotating-arrow collapsed" : "rotating-arrow not-collapsed",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/theme.cljs#L132
  "seqno-theme-container": () => ({ className: "theme-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L936-L948
  "seqno-theme-inner": ({ leftOpen, rightOpen, wide }) => ({
    className: names(
      "theme-inner",
      leftOpen && "ls-left-sidebar-open",
      rightOpen && "ls-right-sidebar-open",
      wide && "ls-wide-mode",
    ),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L950
  app: () => ({ className: "", id: "app-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L951
  "left-container": () => ({ className: "", id: "left-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/page.cljs#L36
  "main-container": () => ({ className: "cp__sidebar-main-layout", id: "main-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/page.cljs#L37
  "main-content-container": () => ({
    className: "scrollbar-spacing",
    id: "main-content-container",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L636
  "main-content": () => ({ className: "cp__sidebar-main-content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L209
  head: () => ({ className: "cp__header", id: "head" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L223
  "head-left": () => ({ className: "l" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L243
  "head-right": () => ({ className: "r" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L60
  "seqno-left-menu": () => ({ className: "button icon cp__header-left-menu", id: "left-menu" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L235
  "seqno-search-button": () => ({ className: "button icon", id: "search-button" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L243-L270
  "seqno-home-button": () => ({ className: "button icon" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/header.cljs#L91
  "seqno-more-button": () => ({ className: "button icon toolbar-dots-btn" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L28
  "seqno-right-toggle": () => ({ className: "button icon toggle-right-sidebar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L553
  "left-sidebar": () => ({ className: "cp__sidebar-left-layout", id: "left-sidebar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L386
  "left-sidebar-inner": () => ({ className: "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.css#L441
  "left-sidebar-resizer": () => ({ className: "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L388
  "left-sidebar-wrap": () => ({ className: "wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L472
  "left-sidebar-contents": () => ({ className: "nav-contents-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L58-L61
  "sidebar-group": ({ group, expanded }) => ({
    className:
      group === null
        ? ""
        : names("nav-content-item", group, expanded ? "is-expand" : "is-collapsed"),
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L62
  "sidebar-group-header": (foldable) => ({ className: foldable ? "header" : "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L67
  "seqno-sidebar-group-body": () => ({ className: "bd" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L301-L310
  "nav-item": () => ({ className: "item" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L301-L310
  "seqno-nav-active": () => ({ className: "active" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L177
  "page-link": ({ kind, name }) => ({ className: `${kind}-item`, "data-ref": name }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L143
  "page-link-icon": () => ({ className: "page-icon" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L144
  "page-link-title": () => ({ className: "page-title" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L414
  "graph-switcher": () => ({ className: "cp__menubar-repos" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/repo.cljs#L218
  "graph-name": () => ({ className: "", id: "repo-name" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L477
  "right-sidebar": () => ({ className: "cp__right-sidebar", id: "right-sidebar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L428
  "right-sidebar-inner": () => ({
    className: "cp__right-sidebar-inner",
    id: "right-sidebar-container",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L432-L433
  "right-sidebar-topbar": () => ({
    className: "cp__right-sidebar-topbar cp__right-sidebar-settings hide-scrollbar",
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L409
  "right-sidebar-resizer": () => ({ className: "resizer" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L435
  "sidebar-tab": () => ({ className: "button cp__right-sidebar-settings-btn" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/handler/events.cljs#L479
  "sidebar-item-list": () => ({ className: "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L254
  "sidebar-item": (type) => ({ className: `content color-level item-type-${type}` }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L259
  "sidebar-item-header": () => ({ className: "color-level" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L284
  "sidebar-item-actions": () => ({ className: "item-actions" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/right_sidebar.cljs#L285-L290
  "sidebar-item-action": () => ({ className: "ui__button" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/container.cljs#L855
  "help-button": () => ({ className: "cp__sidebar-help-btn" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L145
  menu: () => ({ className: "dropdown-wrapper menu-links-wrapper" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L185-L187
  "menu-item": () => ({ className: "menu-link" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L228
  "menu-separator": () => ({ className: "" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L225
  "menu-item-label": () => ({ className: "title-wrap" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/tippy-tooltip.css#L11
  tooltip: () => ({ className: "tippy-tooltip" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/tippy-tooltip.css#L11
  "tooltip-label": () => ({ className: "tippy-tooltip-content" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L602
  dialog: () => ({ className: "ui__modal-panel" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/content.cljs#L32-L34
  "block-menu": () => ({ className: "menu-links-wrapper", id: "custom-context-menu" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/ui.cljs#L87-L91
  "block-menu-color": (clear) => ({ className: names("heading-bg", clear && "remove") }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/content.cljs#L60-L75
  "block-menu-heading": () => ({ className: "ui__button" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/settings.cljs#L1152
  settings: () => ({ className: "cp__settings-main cp__settings-inner settings-modal" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1218
  "plugins-dialog": () => ({ className: "cp__plugins-page" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L1226
  "plugins-tabs": () => ({ className: "tabs" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L297
  "plugin-card": () => ({ className: "cp__plugins-item-card" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/plugins.cljs#L90
  "plugin-themes": () => ({ className: "cp__themes-installed" }),
}
