# @seqno/whiteboard

Logseq's whiteboards: the canvas logic and the board UI.

A board is a page whose `ls-type` is `whiteboard-page`. Each shape is a top-level block on it, with its tldraw props as JSON in `logseq.tldraw.shape` (see `@seqno/domain`'s `whiteboard.ts`), and block order is the z-order. A shape's words live in its block's text: a text shape's text, a box, ellipse, triangle or connector's label, a portal's `[[page]]` or `((uuid))`. So shapes sync and undo like any block, and links on a board show up in linked references.

- `geometry.ts`: camera, bounds, edge clipping.
- `model.ts`: blocks to a scene (items, bounds, connector ends clipped to the shapes they bind to), hit tests.
- `gestures.ts`: pointer gestures and the commands each one commits.
- `commands.ts`: move, resize, delete, z-order and text edits as `Command`s.
- `preview.ts`: a gesture's commands applied locally, so a drag draws before the core answers.
- `arrange.ts`: align, distribute, pack and flip.
- `camera.ts`: the 100ms glide between cameras and each board's saved camera.
- `media.ts`: dropped and pasted files and links, sized as Logseq sizes them.
- `links.tsx`: shape links, Quick Links and backlinks.
- `Embeds.tsx`: YouTube, tweet, website, HTML, video and PDF shapes.
- `Rotate.tsx`: rotate targets and Logseq's rotate and resize cursors.
- `Preview.tsx`: a board's drawing without the editor, for cards, embeds and Export.

Test: `pnpm --filter @seqno/whiteboard exec vitest run`.
