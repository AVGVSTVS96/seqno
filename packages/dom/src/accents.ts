import * as radix from "@radix-ui/colors"

// https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/colors.cljs#L6
// https://github.com/logseq/logseq/blob/0.10.9/packages/ui/src/colors.css#L56-L1241
const grayOf = {
  tomato: "mauve",
  red: "mauve",
  crimson: "mauve",
  pink: "mauve",
  plum: "mauve",
  purple: "mauve",
  violet: "mauve",
  indigo: "slate",
  blue: "slate",
  cyan: "slate",
  teal: "sage",
  green: "sage",
  grass: "olive",
  orange: "sand",
} as const

export type AccentColor = keyof typeof grayOf

export type AccentChoice = AccentColor | "logseq" | "none"

export const accentColors = Object.keys(grayOf).filter(
  (color): color is AccentColor => color in grayOf,
)

type Scale = "accent" | "gray"

// https://github.com/logseq/logseq/blob/0.10.9/packages/ui/src/colors.css#L114-L137
const roles: ReadonlyArray<readonly [string, Scale, number, "alpha"?]> = [
  ["--ls-primary-background-color", "gray", 1],
  ["--ls-secondary-background-color", "gray", 2],
  ["--ls-tertiary-background-color", "gray", 3],
  ["--ls-quaternary-background-color", "gray", 4],
  ["--ls-link-text-color", "accent", 11],
  ["--ls-link-text-hover-color", "accent", 12],
  ["--ls-block-ref-link-text-color", "accent", 9],
  ["--ls-secondary-text-color", "gray", 11],
  ["--ls-primary-text-color", "gray", 12],
  ["--ls-border-color", "gray", 5],
  ["--ls-secondary-border-color", "accent", 5],
  ["--ls-page-checkbox-color", "gray", 7],
  ["--ls-selection-background-color", "gray", 4, "alpha"],
  ["--ls-block-highlight-color", "gray", 4],
  ["--ls-focus-ring-color", "accent", 9],
  ["--ls-table-tr-even-background-color", "gray", 4],
  ["--ls-page-properties-background-color", "gray", 4],
  ["--ls-block-properties-background-color", "gray", 3],
  ["--ls-page-inline-code-bg-color", "gray", 3],
  ["--ls-cloze-text-color", "accent", 8],
  ["--ls-wb-stroke-color-default", "accent", 7],
  ["--ls-wb-background-color-default", "accent", 4],
  ["--ls-wb-text-color-default", "gray", 12],
  ["--ls-a-chosen-bg", "gray", 1],
]

const isColor = (value: string | Readonly<Record<string, string>>): value is string =>
  typeof value === "string"

const steps = (name: string, dark: boolean, alpha: boolean) =>
  Object.values(
    Object.entries(radix).find(
      ([key]) => key === `${name}${dark ? "Dark" : ""}${alpha ? "A" : ""}`,
    )?.[1] ?? {},
  ).filter(isColor)

const two = (step: number) => String(step).padStart(2, "0")

const declarations = (color: AccentColor, dark: boolean) => {
  const scale = (which: Scale, alpha: boolean) =>
    steps(which === "accent" ? color : grayOf[color], dark, alpha)

  const ramps = (["accent", "gray"] as const).flatMap((which) =>
    [false, true].flatMap((alpha) =>
      scale(which, alpha).map(
        (value, at) => `--lx-${which}-${two(at + 1)}${alpha ? "-alpha" : ""}: ${value};`,
      ),
    ),
  )

  const named = roles.map(
    ([variable, which, step, alpha]) =>
      `${variable}: ${scale(which, alpha === "alpha")[step - 1] ?? "initial"};`,
  )

  return [...ramps, ...named].join(" ")
}

export const accentStyles = accentColors
  .flatMap((color) => [
    `:root[data-color="${color}"] { ${declarations(color, false)} }`,
    `:root[data-color="${color}"][data-theme="dark"] { ${declarations(color, true)} }`,
  ])
  .join("\n")

export const accentScale = (color: AccentColor, dark: boolean) => steps(color, dark, false)
