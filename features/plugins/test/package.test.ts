import { describe, expect, it } from "vitest"
import { pluginInfoOf, settingItems } from "../src/package.ts"

const listing = {
  id: "logseq-dev-theme",
  title: "Dev theme",
  description: "A theme inspired by Dev.to & Figma.",
  author: "pengx17",
  repo: "pengx17/logseq-dev-theme",
  icon: null,
}

const root = "https://files.test/pengx17/logseq-dev-theme/v1.26.17/"

describe("pluginInfoOf", () => {
  it("reads a theme-only package: no entry, themes resolved against its files", () => {
    const info = pluginInfoOf(listing, root, {
      version: "v1.26.17",
      logseq: {
        id: "pengx17_dev_theme",
        icon: "./logo.png",
        themes: [
          { name: "Dev theme", url: "./custom.css" },
          { name: "Dark", url: "./dark.css", mode: "dark", description: "Night" },
        ],
      },
    })
    expect(info.main).toBe(null)
    expect(info.icon).toBe(`${root}logo.png`)
    expect(info.themes).toEqual([
      {
        pid: "logseq-dev-theme",
        name: "Dev theme",
        url: `${root}custom.css`,
        mode: null,
        description: "",
      },
      {
        pid: "logseq-dev-theme",
        name: "Dark",
        url: `${root}dark.css`,
        mode: "dark",
        description: "Night",
      },
    ])
  })

  it("takes the entry from logseq.entry, then logseq.main, then main", () => {
    expect(pluginInfoOf(listing, root, { main: "dist/index.html" }).main).toBe("dist/index.html")
    expect(pluginInfoOf(listing, root, { main: "x.html", logseq: { main: "y.html" } }).main).toBe(
      "y.html",
    )
  })
})

describe("settingItems", () => {
  it("keeps the fields the settings form needs and drops items without a key or type", () => {
    expect(
      settingItems([
        {
          key: "pomodoroLength",
          type: "number",
          default: 25,
          title: "Length",
          description: "Minutes",
        },
        {
          key: "sound",
          type: "enum",
          enumChoices: ["bell", "none"],
          enumPicker: "radio",
          default: "bell",
        },
        { title: "no key" },
      ]),
    ).toEqual([
      {
        key: "pomodoroLength",
        type: "number",
        title: "Length",
        description: "Minutes",
        default: 25,
        inputAs: null,
        enumChoices: [],
        enumPicker: null,
        buttonAction: null,
      },
      {
        key: "sound",
        type: "enum",
        title: "",
        description: "",
        default: "bell",
        inputAs: null,
        enumChoices: ["bell", "none"],
        enumPicker: "radio",
        buttonAction: null,
      },
    ])
  })
})
