import { names, type Table } from "./names.ts"

export interface AssetParts {
  readonly "seqno-asset": readonly [{ readonly kind: "pdf" | "doc"; readonly url: string }]
  readonly "seqno-asset-video": readonly [{ readonly ext: string }]
  readonly "seqno-image-frame": readonly []
  readonly "seqno-image": readonly []
  readonly "seqno-image-overlay": readonly []
  readonly "seqno-image-actions": readonly []
  readonly "seqno-image-action": readonly []
}

export const assetParts: Table<AssetParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L1058-L1065
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L422-L423
  "seqno-asset": ({ kind, url }) => ({
    className: names("asset-ref", `is-${kind}`),
    "data-href": url,
  }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L730-L731
  "seqno-asset-video": ({ ext }) => ({ className: "asset-ref-wrap", "data-ext": ext }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L278
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L298
  "seqno-image-frame": () => ({ className: "resize image-resize asset-container" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L299
  "seqno-image": () => ({ className: "rounded-sm relative" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L308
  "seqno-image-overlay": () => ({ className: "asset-overlay" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L310
  "seqno-image-actions": () => ({ className: "asset-action-bar" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/block.cljs#L325
  "seqno-image-action": () => ({ className: "asset-action-btn" }),
}
