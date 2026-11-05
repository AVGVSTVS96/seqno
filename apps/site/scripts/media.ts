import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { encode, media } from "./encode.ts"

const seqno = resolve(process.env["SEQNO_REPO"] ?? join(import.meta.dirname, "../../../seqno"))
const scratch = mkdtempSync(join(tmpdir(), "seqno-media-"))
const margin = 96
const top = 24

for (const theme of ["light", "dark"]) {
  const showcase = join(scratch, `showcase-${theme}.png`)
  const source = join(seqno, "docs/screenshots", `showcase-${theme}.png`)
  const geometry = `2880x${1800 - top}+${margin}+${margin + top}`
  execFileSync("magick", [source, "-crop", geometry, "+repage", showcase])
  encode(showcase, `showcase-${theme}`, [800, 1440, 2256])
  for (const loop of ["outline", "queries"]) {
    const video = join(media, `${loop}-${theme}.mp4`)
    if (!existsSync(video)) continue
    const still = join(scratch, `${loop}-${theme}.png`)
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", video, "-frames:v", "1", still])
    encode(still, `${loop}-${theme}`, [600, 1200])
  }
}

rmSync(scratch, { recursive: true })
