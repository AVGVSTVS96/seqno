import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export const media = resolve(import.meta.dirname, "../src/media")

const flags = (line: string) => line.split(" ")
const run = (command: string, args: ReadonlyArray<string>) =>
  execFileSync(command, args, { stdio: "inherit" })

export function encode(png: string, name: string, widths: ReadonlyArray<number>) {
  const scratch = mkdtempSync(join(tmpdir(), "seqno-encode-"))
  for (const width of widths) {
    const resized = join(scratch, `${width}.png`)
    const out = join(media, `${name}-${width}`)
    run("magick", [png, ...flags(`-filter Lanczos -resize ${width}x -strip`), resized])
    run("magick", [resized, ...flags("-quality 84 -define webp:method=6"), `${out}.webp`])
    run("ffmpeg", [
      ...flags("-loglevel error -y -i"),
      resized,
      ...flags("-c:v libaom-av1 -still-picture 1 -crf 24 -cpu-used 4 -pix_fmt yuv444p"),
      `${out}.avif`,
    ])
  }
  rmSync(scratch, { recursive: true })
}
