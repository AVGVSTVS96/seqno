import { describe, expect, it } from "vitest"
import { parseTimestamp, parseVideo } from "../src/index.ts"

describe("parseVideo", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", 0],
    ["https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42", 42],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", 90],
    ["https://youtu.be/dQw4w9WgXcQ?t=1h2m3s", 3723],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ?start=15", 15],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", 0],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", 0],
    ["youtube.com/live/dQw4w9WgXcQ", 0],
  ])("reads the YouTube id and start of %s", (url, start) => {
    expect(parseVideo(url)).toEqual({ _tag: "YouTube", id: "dQw4w9WgXcQ", start })
  })

  it("reads a Vimeo id, with the hash of an unlisted video", () => {
    expect(parseVideo("https://vimeo.com/76979871")).toEqual({
      _tag: "Vimeo",
      id: "76979871",
      hash: null,
    })
    expect(parseVideo("https://vimeo.com/76979871/2f1b0a3c9d")).toEqual({
      _tag: "Vimeo",
      id: "76979871",
      hash: "2f1b0a3c9d",
    })
    expect(parseVideo("https://player.vimeo.com/video/76979871?h=2f1b0a3c9d")).toEqual({
      _tag: "Vimeo",
      id: "76979871",
      hash: "2f1b0a3c9d",
    })
  })

  it("plays a direct video file, remote or in the graph's assets", () => {
    expect(parseVideo("https://example.com/clips/demo.mp4?raw=1")).toEqual({
      _tag: "File",
      url: "https://example.com/clips/demo.mp4?raw=1",
    })
    expect(parseVideo("  ../assets/clip_1.webm ")).toEqual({
      _tag: "File",
      url: "../assets/clip_1.webm",
    })
    expect(parseVideo("../assets/recording.WEBM")).toEqual({
      _tag: "File",
      url: "../assets/recording.WEBM",
    })
  })

  it("leaves other links alone", () => {
    expect(parseVideo("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseVideo("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(parseVideo("https://vimeo.com/about")).toBeNull()
    expect(parseVideo("https://example.com/page.html")).toBeNull()
    expect(parseVideo("")).toBeNull()
  })
})

describe("parseTimestamp", () => {
  it.each([
    ["90", 90],
    ["1:30", 90],
    ["01:02:03", 3723],
    [" 0:05 ", 5],
  ])("reads %s as %d seconds", (text, seconds) => {
    expect(parseTimestamp(text)).toBe(seconds)
  })

  it("rejects text that isn't a time", () => {
    expect(parseTimestamp("1:75")).toBeNull()
    expect(parseTimestamp("soon")).toBeNull()
    expect(parseTimestamp("")).toBeNull()
  })
})
