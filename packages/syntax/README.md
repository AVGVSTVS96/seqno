# @seqno/syntax

A pure parser for Logseq markdown: file to block tree and back, byte for byte, plus the block and inline parsers that both the core and the UI render with.

## What's inside

| Module          | Exports                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.ts`   | `parse` / `print`: a lossless tree of raw lines. `print(parse(s)) === s` for any string.                                                                                                             |
| `outline.ts`    | `toOutline` / `render`: blocks with text plus their `Format` (indent, line endings, final newline, BOM). Logseq-written files round-trip exactly.                                                    |
| `block.ts`      | `analyzeBlock`: marker, priority, heading, properties, `id::`, SCHEDULED / DEADLINE, refs, macros and code regions, all with spans. `setProperty` and `applyEdit` make and apply minimal text edits. |
| `inline.ts`     | `parseInline`, `plainText`: page refs, tags, block refs, macros, emphasis, links, images, inline code.                                                                                               |
| `content.ts`    | `blockContent`: what a block shows (title, visible properties, planning, logbook, code, quotes, headings), plus `setMarker`, `propertyValue`, `isHiddenProperty`, `clockTotal`.                      |
| `properties.ts` | `splitProperties` / `joinProperties`: the `key:: value` lines after a block's first line, split from and joined back into its text.                                                                  |
| `paste.ts`      | `pastedBlocks`: pasted text as an outline, or one block per paragraph.                                                                                                                               |
| `rename.ts`     | `renameRefs`, `renameInProperty`: rewrite `[[refs]]` and `#tags` when a page is renamed.                                                                                                             |
| `video.ts`      | `parseVideo`, `parseTimestamp`: the URL in `{{video}}` as YouTube (id, start), Vimeo (id, unlisted hash) or a direct file, and `{{youtube-timestamp}}` as seconds.                                   |

A block's text is its full markdown with bullet indentation removed, property and planning lines included. Refs inside code, fences and queries are ignored.

## Tests

```sh
pnpm test --project @seqno/syntax
```

## Known gaps

- Only `-` bullets start blocks, so a plain markdown file with no bullets lands whole in `preamble`. Logseq splits its top-level headings into blocks.
- YAML front matter stays in `preamble`; its keys are not read as page properties.
- Org-mode files are not parsed.
