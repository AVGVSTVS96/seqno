import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"
import { references } from "./logseq.ts"
import { scenes } from "./scenes.ts"
import { themes } from "./theme.ts"

const Notes = Schema.Record(
  Schema.String,
  Schema.Struct({ logseq: Schema.Array(Schema.String), seqno: Schema.Array(Schema.String) }),
)
export type Notes = typeof Notes.Type

const decodeNotes = Schema.decodeUnknownSync(Schema.fromJsonString(Notes))

export const readNotes = async (out: string): Promise<Notes> =>
  decodeNotes(await readFile(join(out, "notes.json"), "utf8").catch(() => "{}"))

export const writeNotes = (out: string, notes: Notes) =>
  writeFile(join(out, "notes.json"), `${JSON.stringify(notes, null, 2)}\n`)

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const figure = (files: ReadonlySet<string>, file: string, label: string) =>
  files.has(file)
    ? `<figure><figcaption>${label}</figcaption><a href="${file}"><img src="${file}" alt="${label}" loading="lazy"></a></figure>`
    : `<figure class="missing"><figcaption>${label}</figcaption><p>not captured yet</p></figure>`

const difference = (files: ReadonlySet<string>, base: string) =>
  files.has(`${base}.logseq.png`) && files.has(`${base}.seqno.png`)
    ? `<figure class="diff"><figcaption>difference (black = identical)</figcaption><div><img src="${base}.seqno.png" alt=""><img src="${base}.logseq.png" alt=""></div></figure>`
    : ""

const noteList = (notes: ReadonlyArray<string>, app: string) =>
  notes.map((note) => `<li><b>${app}</b> ${escape(note)}</li>`).join("")

export const writeCompare = async (out: string) => {
  const files = new Set(await readdir(out))
  const notes = await readNotes(out)
  const sections = scenes.map((scene) => {
    const reference = references[scene.reference]
    const rows = themes.map((theme) => {
      const base = `${scene.id}-${theme}`
      const found = notes[base]
      const list = noteList(found?.logseq ?? [], "Logseq:") + noteList(found?.seqno ?? [], "seqno:")
      return `<div class="row"><h3>${theme}</h3>${list === "" ? "" : `<ul>${list}</ul>`}<div class="pair">${figure(files, `${base}.logseq.png`, reference.name)}${figure(files, `${base}.seqno.png`, "seqno")}${difference(files, base)}</div></div>`
    })
    return `<section id="${scene.id}"><h2>${escape(scene.title)} <small>${scene.id} · reference <a href="${reference.url}">${reference.name}</a></small></h2>${rows.join("")}</section>`
  })
  const index = scenes
    .map((scene) => `<a href="#${scene.id}">${escape(scene.title)}</a>`)
    .join(" · ")
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>seqno design compare</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; background: #f4f4f4; color: #222 }
nav { margin-bottom: 16px }
section { margin-bottom: 48px }
h2 small { font-weight: 400; color: #777; font-size: 13px }
h3 { margin: 12px 0 4px; font-size: 13px; text-transform: uppercase; color: #777 }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px }
figure { margin: 0 }
figcaption { font-size: 12px; color: #555; margin-bottom: 4px }
img { width: 100%; display: block; border: 1px solid #ccc }
.missing p { aspect-ratio: 1440 / 900; display: grid; place-items: center; border: 1px dashed #bbb; margin: 0; color: #999 }
.diff { display: none; grid-column: 1 / -1 }
.diff div { position: relative }
.diff div img + img { position: absolute; inset: 0; mix-blend-mode: difference }
#show-diff:checked ~ section .diff { display: block }
ul { margin: 4px 0 8px; padding-left: 18px; color: #a33 }
</style>
<h1>seqno design compare</h1>
<p>Each scene at 1440×900, Logseq on the left and seqno on the right. Click an image for full size. Regenerated ${new Date().toISOString()}.</p>
<nav>${index}</nav>
<input type="checkbox" id="show-diff"> <label for="show-diff">show difference images</label>
${sections.join("\n")}
</html>
`
  await writeFile(join(out, "compare.html"), html)
}
