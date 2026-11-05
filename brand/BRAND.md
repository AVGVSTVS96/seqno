# seqno · brand

**The idea in a sentence:** seqno is built from the outliner's own parts, the bullet, the guide line and the dot-grid page, on one warm field color, and its name is a real, live sequence number.

Open `specimen.html` to see all of it working, including the hero. `shots/` has it rendered in light and dark.

## Personality

- **Calm and exact.** A tool you trust with years of notes. Nothing wiggles for attention; things move because something happened.
- **Friendly, not cute.** Warm color, round shapes, plain words. No mascots, no exclamation marks.
- **Honest about being early.** Work in progress is shown as a number that goes up, not hidden behind "coming soon".
- **One person's careful rebuild.** First person when Bassim speaks. No "we", no company voice.

| it is | it isn't |
| --- | --- |
| a local-first outliner | a second brain, a knowledge platform |
| Logseq's way of working, rebuilt clean | a Logseq fork, a Logseq theme |
| early, and numbered | "coming soon" |
| the bullet and the guide line | graphs of glowing nodes |

## Name and voice

- **Always lowercase "seqno"**, also at the start of a sentence and in titles. Never Seqno, SeqNo, SEQNO, seq-no.
- In uppercase mono labels, keep the name out, or wrap it so CSS doesn't uppercase it (`text-transform: none`).
- The º in the logo is drawn, never typed. In text, the name is plain "seqno".
- It means sequence number: every edit gets a number in the edit log, and update files are named by op counter. Say this once, plainly; don't pun on it.
- Write like the README: short sentences, real numbers, what works and what doesn't. "Every edit saves to a log on your device, every 250 ms." "It runs in Chrome and Edge. It's not ready for your real notes yet."
- Bassim's story is first person: "I watched my favorite note app get worse, so I rebuilt it."
- Logseq is named only to say what seqno opens and resembles. Never Logseq's logo, colors, screenshots or text.
- Don't use: supercharge, seamless, effortless, blazing, powerful, beautiful, magical, revolutionary, second brain, unlock, AI-native, waitlist.

## Logo

**Pick: C, Numero.** seqno is short for sequence number, so the last two letters are set as the numero sign, nº: a round bullet sitting on a line. That bullet is the dot the app draws in front of every block; the line under it is the row of text after it. The name still reads normally, the idea is there for anyone who looks, and "nº" on its own is a mark that holds up down to a 16px favicon.

Three directions were drawn (`logo/explore-*.svg`, shown in the specimen):

- **A · Outline** (`explore-a-outline.svg`). The app itself as a mark: a parent bullet, its guide line and two indented children, each with a line of text. It says "outliner" at any size and would animate well, bullets dropping into rows. Passed because it is also the bulleted-list button in every editor toolbar. It names the category, not seqno.
- **B · Bullet q** (`explore-b-bullet-q.svg`). The q in the middle of the name rebuilt from two parts: a perfect round bullet and a straight stem, so the outliner's bullet sits inside the word. Bold and very ownable. Passed because at small sizes the disc and bar read as media buttons (record, pause), and the gap splits the word in two at text sizes.
- **C · Numero** (`explore-c-numero.svg`). Picked, above.

Construction (units of 1000 per em, from `logo/gen.mjs`):

- Letters: Wix Madefor Display 800, outlined, tracking −36.
- º: a disc 276 wide (half the font's o) whose top sits on the x-height (526), over a bar 276 × 82 that sits on the baseline. 14 between the n's advance and the º.
- App icon: a superellipse tile (exponent 5) in apricot, the "nº" mark in ink at 62% of the tile width (74% in the favicon).

Rules:

- **Clear space:** the width of the º disc on every side.
- **Smallest sizes:** wordmark 20px tall, mark 16px. Below that, set "seqno" in Wix Madefor Display 700.
- **Color pairs only:** ink on paper, ink on apricot, apricot or paper-dark on dark. The tile is always apricot with an ink mark, or one solid color with the mark cut out (`*-mono.svg`). Never put the apricot tile on apricot.
- **Never** outline, stretch, rotate, add effects to, or recolor the º on its own.
- **Grain** only on the hero wordmark and the link preview. Everywhere else the logo is clean.

## Type

All three families are under the SIL Open Font License and self-hosted from `fonts/` (latin subset, woff2, licenses next to them).

| family | file | use |
| --- | --- | --- |
| **Wix Madefor Display** | `wix-madefor-display.woff2` (variable wght 400–800) | logo, headlines, taglines |
| **Wix Madefor Text** | `wix-madefor-text.woff2`, `-italic.woff2` (variable wght 400–800) | body, UI, buttons |
| **Commit Mono** | `commit-mono-400.woff2`, `commit-mono-500.woff2` | labels, numbers, the odometer, code |

Display and Text were drawn as one family: Display is tighter for big sizes, Text is opened up for small ones. The Display's round o and q are the same circle as the bullet, which is why the wordmark and the creatures belong together. Commit Mono has the warmth of a typewriter, fixed-width figures for the odometer, and is a face Bassim saved himself.

| role | family · weight | size / line | tracking | notes |
| --- | --- | --- | --- | --- |
| display | Display 700 | 64/72 (mobile 44/48) | −0.035em | one per page at most |
| h1 | Display 650 | 44/48 (mobile 32/40) | −0.03em | section titles |
| lede | Display 450 | 30/48 (mobile 22/36) | −0.02em | taglines; 48 = two grid rows |
| h2 | Display 600 | 24/32 | −0.015em | |
| h3 | Display 600 | 20/28 | −0.012em | card titles |
| body | Text 400 | 17/28 | −0.005em | measure 36em |
| small | Text 400 | 15/24 | 0 | ink-2 |
| ui | Text 550 | 15/20 | 0 | buttons, nav |
| label | Mono 400 uppercase | 11/16 | +0.14em | "Work in progress" |
| number | Mono 500 | 13/22 | 0 | odometer, stats |
| code | Mono 400 | 14/24 | 0 | paths, commands |

- Load with `font-display: swap` and metric-adjusted fallbacks (`size-adjust`, `ascent-override`) so the hero doesn't shift. The hero draws its canvas after `document.fonts.ready`, because the bullets avoid the text boxes.
- Trim display type to the grid with `text-box: trim-both cap alphabetic` where it matters (headlines next to a bullet).

## Color

Paper, ink and one field color. **Apricot** is seqno's: warm, light and friendly, and nothing like Logseq's teal or Buzz's chartreuse. It's the field by day. By night the field is **dusk**, and apricot moves into the ink.

Dusk comes from the product, not from apricot. seqno's dark theme is Logseq's Solarized dark, so every dark screenshot on the page is deep blue (`#002B36`, `oklch(0.27 0.05 220)`). Darkening apricot gave a brown at the same lightness as those screenshots and the opposite hue, and the two cancelled into mud. Dusk is the screenshots' own blue one step darker, so they sit on it like lit windows, and apricot plays the part Solarized gives its orange: small, light and bright on the deep blue.

| token | light | dark | use |
| --- | --- | --- | --- |
| `--paper` | `#FDF9F4` | `#02141B` | page |
| `--surface` | `#FFFFFF` | `#002B36` | cards, screenshot frames (by night the app's own background) |
| `--sunk` | `#F8F1EA` | `#01222C` | quiet panels, window bars (by night the same as the field) |
| `--ink` | `#25170D` (16.6:1) | `#F1EAE3` (15.8:1) | text, bullets |
| `--ink-2` | `#655449` (6.9:1) | `#A3B5B8` (8.8:1) | secondary text |
| `--ink-3` | `#7A6C61` (4.8:1) | `#7E9094` (5.6:1) | labels, hints |
| `--hair` | `rgb(37 23 13 / .12)` | `rgb(241 234 227 / .12)` | 1px rules, card rings |
| `--hair-2` | `rgb(37 23 13 / .06)` | `rgb(241 234 227 / .06)` | row dividers |
| `--rust` | `#AE4819` (5.4:1) | `#F8AA6D` (9.8:1) | links, the one highlighted path |
| `--field` | `#F8AA6D` apricot | `#01222C` dusk | hero, link preview, field swatches |
| `--field-ink` | `#25170D` (9.1:1) | `#F8AA6D` (8.7:1) | wordmark, tagline and pills on the field |
| `--field-faint` | `#25170D` | `#F1EAE3` | what faint lines on the field are mixed from: outlines, the guide, the small print |
| `--bullet` | `#FFF8ED` | `#F4D9C0` | bullets swimming on the field |
| `--grid-dot` | `rgb(37 23 13 / .2)` | `rgb(241 234 227 / .14)` | the field's dot grid |
| `--line-opacity` | `0.5` | `0.8` | the hero's text bars and tails |
| `--selection` | apricot at 55% | `#094B5A` | selected text |

Contrast ratios are against `--paper` (or the field, for field tokens). OKLCH sources: apricot `oklch(0.80 0.12 58)`, dusk `oklch(0.23 0.04 222)`, dark paper `oklch(0.18 0.03 224)`, ink `oklch(0.22 0.03 55)`, paper `oklch(0.985 0.008 75)`.

- Apricot is a **field**, not an accent. By day it fills the hero and the link preview; it never tints buttons or text on paper (use `--rust` there). By night it's the ink on dusk.
- One highlight per view: `--rust` marks the thing being talked about, like one path in a diagram or the active bullet. Never a second accent color.
- Dark is the same tokens swapped, never a second design. The site follows `prefers-color-scheme` and switches with `light-dark()` or the media query.
- **Dark is built around the dark screenshots.** Every dark surface is their blue (hue 220 to 225) or close to neutral, never warm, and each layer toward you is lighter: paper 0.18, field and panels 0.23, screenshots 0.27. Window bars and quiet panels are the field's blue.
- **Apricot stays light.** Never darken it, and never lay it over blue at low opacity: half apricot, half blue is a gray-brown, and a 30% outline is khaki. Faint things on dusk (the dot grid, outlines, the small print) are mixed from cream instead, and the hero's lines run at 80%.
- Before changing a dark token, render the whole page in dark at real size and look at every place a screenshot meets the page. `site/shots/dark-fix/` shows what goes wrong when only the hero is checked.
- Never Logseq's logo, or its teal (`#85C8C8` family) in seqno's own marks. The deep blue is there because seqno's own screenshots bring it.

## Grid and spacing

- **The row is 24px.** The outliner's row and indent are both 24. The field's dot grid is 24px, with dots at the center of each cell (`radial-gradient(circle, var(--grid-dot) 1px, transparent 1.4px) 0 0 / 24px 24px`), so a bullet always lands on a dot. A dot is an empty row; a bullet is a row with something in it.
- **Spacing steps by 8:** 4 · 8 · 16 · 24 · 32 · 48 · 72 · 96 · 120. Sections are 120 apart on desktop, 72 on mobile.
- **Page:** 1128px max content width, 24px gutters, hero full-bleed.
- **Corners:** 6 for small UI (kbd, chips, inputs), 12 for cards and screenshot frames, fully round for buttons and pills. App icon: superellipse.
- **Lines:** 1px `--hair` rings instead of borders. No drop shadows except screenshot frames: `0 0 0 1px var(--hair), 0 30px 60px -30px rgb(37 23 13 / .25)`.

## Motifs

1. **The bullet.** A 6–8px disc: ink on paper, `--bullet` on the field, `--rust` when active. It is the brand's only real icon.
2. **The guide line.** 1px at 32–55% opacity, under a parent's bullet, as long as its children. While a bullet swims, the same line hangs behind it and swings.
3. **The dot-grid page.** The 24px dot grid on the field (20% ink), and at 12% on quiet paper panels. Never behind running text.
4. **Copy as outlines.** Taglines, feature lists and diagram details are set as real outlines with the app's row, indent and guide. Page sections are blocks too: an 8px bullet beside each section title and a 1px guide line down the section's left edge.
5. **The sequence number.** `Nº 0194` in Commit Mono in a ruled counter: the seqno repo's real commit count. It rolls only when the number changed since your last visit.
6. **Grain.** Soft, still grain on the big wordmark, like ink on rough paper. Only on the hero and the link preview.

## Iconography

Almost none. The bullet does most of the work, and glyphs the fonts have cover the rest: `→ ↗ · ⌘ K`. When an icon is needed, use [Tabler Icons](https://tabler.io/icons) (MIT, the set the app already uses) at 20px, stroke 1.75, in `--ink-2`. No filled icons, no colored icons, no icons inside boxes.

## Motion

Principles:

- **Motion follows state.** Things move because something happened: the page loaded, the pointer moved, the commit count changed, a section scrolled into view. No `setTimeout` or `setInterval` choreography, no scroll hijacking, no parallax, no animated noise.
- **One physical model.** Things keep their velocity. A bullet that was swimming curves into place from wherever it was heading, so every landing is a little different.
- **Still means still.** A pointer that stops is ignored, a hidden tab stops the loop, the school comes to rest on its own, and `prefers-reduced-motion` draws the settled state with nothing moving.

Tokens for motion/react:

```ts
export const spring = {
  fast: { type: "spring", visualDuration: 0.2, bounce: 0 },     // press, hover, toggles, popovers. ≈330 ms to settle
  base: { type: "spring", visualDuration: 0.35, bounce: 0.15 }, // enter, layout, menus. ≈540 ms
  slow: { type: "spring", visualDuration: 0.6, bounce: 0.25 },  // odometer digits, outlines landing. ≈890 ms
} as const

export const fade = { duration: 0.16, ease: [0.23, 1, 0.32, 1] } as const // color and opacity only
```

In stiffness and damping (mass 1): fast 685 / 52.4, base 224 / 25.4, slow 76 / 13.1. Wrap the app in `<MotionConfig reducedMotion="user">`.

- Buttons scale to 0.97 on press with `spring.fast`. Links fade color with `fade`.
- Outlines in page sections land once as they scroll into view: each row has its own `whileInView` with `viewport={{ once: true }}`, the bullet scales from 0 and the text rises 8px with `spring.base`. Rows land in page order because they enter the viewport in page order, not because of a delay.

### The hero: scattered thoughts settle into outlines

The hero is a dot-grid page in the field color with little outlines on it. On load the bullets start scattered and drift as a loose school, then curve home and land on the grid as outlines. Move the pointer through them and the nearby ones scatter and swim off; leave them alone and each returns to its row on its own. As the bullets land, the big wordmark comes into focus. The reference implementation is `hero.js` (`createSchool(canvas, options)`); the specimen runs it live.

- **Bullets** are 6–7.6px discs in `--bullet`, 12% in `--field-ink`. Each has a 1px tail that hangs below it and swings opposite its velocity on a spring (stiffness 140, damping 9: a little secondary motion). When a bullet lands as a parent, its tail grows into the guide line down to its last child; a leaf's tail shrinks away. A faint bar of text (3px at `--line-opacity`, 50% on apricot and 80% on dusk, on a field-colored underlay that hides the grid dots) grows to the right of each landed bullet. Moving bullets stretch up to 1.45× along their velocity.
- **Outlines:** 9 of them at 1440 × 900, 3 to 6 rows each, depth 0–2, text bars 3–7 columns wide, placed on the grid away from the tagline, wordmark, label and top bar. Scale the count with area (about one per 130,000 px², 4 to 12).
- **Swimming:** a smooth flow field at 34 px/s, plus alignment and separation with neighbors within 56px, plus a soft wall 48px from each edge.
- **Waking:** a bullet within 150px of a pointer moving faster than 40 px/s gets its "loose" value set near 1. Loose decays with τ = 1.4 s. Loose bullets swim; settled bullets home in. The blend uses smoothstep on the loose value.
- **Fleeing:** within 110px of a moving pointer, push away at up to 2600 px/s², falling off with the square of distance. Speed caps at 620 px/s.
- **Homing:** steer toward the slot at up to 220 px/s, desired speed 4 × distance, steering gain 6 (about a spring of stiffness 24, damping ratio 0.6). Because velocity is kept, every landing curves.
- **Wordmark focus:** two layers of the wordmark, one heavily blurred and one nearly sharp, crossfaded by how many bullets have landed (the mean of each bullet's settledness, smoothstepped between 0.25 and 0.7).
- **Pointer velocity** comes from pointer events. A frame with no pointer event counts as speed 0, so a resting pointer wakes nothing.
- **Lifecycle:** pause on `visibilitychange`; on resize, rebuild with the bullets already at home (no replayed intro); with reduced motion, draw the settled outlines once.

Porting to motion/react: keep the simulation in a plain module (it's already one) and drive it from `useAnimationFrame`. Feed it pointer events from the hero element. Put the "settled" ratio in a `useMotionValue` and derive the two wordmark opacities with `useTransform`. Read colors from the CSS tokens once, and again when the color scheme changes.

### The odometer

- The number is the seqno repo's commit count on `main`. Bake it in at build time (`git rev-list --count HEAD`, or the last page of the GitHub API's `/repos/AVGVSTVS96/seqno/commits?per_page=1`), then fetch the live count on load. Today it is 194.
- It rolls only when the count really went up: from the number you last saw (kept in `localStorage`), or from the baked number on a first visit, to the live one. If nothing changed, nothing moves. If the fetch fails, show the baked number. It never ticks on a timer.
- Four digits or more, zero-padded, in Commit Mono 500 13/22, each digit in its own 14px cell with a 1px rule between cells, after a `Nº` cell. The copy says "No."; the label sets it as the numero sign, the same mark as the logo.
- Each digit is a strip of 0–9 twice, moved with `spring.slow`, always rolling upward, with a 0.6px blur while it moves.
- It links to `github.com/AVGVSTVS96/seqno/commits/main`, and its tooltip is the copy's sentence-case line. With reduced motion it shows the number without rolling.

### Grain filter

SVG filter on the wordmark, values for a wordmark about 900px wide (scale blur and displacement with the width):

- **sharp layer:** `feGaussianBlur` 3.5 on `SourceAlpha` → `feTurbulence` fractalNoise, baseFrequency 0.85, 3 octaves, seed 4 → `feDisplacementMap` scale 11 → alpha `slope 1.8, intercept −0.3` → flood with `--field-ink`.
- **soft layer:** blur 14, displacement 26, no alpha curve.
- The noise seed never animates. Grain is a texture, not motion.

## The hero, composed

At 1440 × 900 (see `shots/hero-light.png` and `shots/hero-dark.png`), with the copy from `copy/SITE.md`:

- Field full-bleed, height `clamp(640px, 100svh, 900px)`, the dot grid aligned to the canvas origin.
- Top left, 24px in: `lockup-mono.svg`, 26px tall, in `--field-ink`. Nothing else in the top bar.
- One left-aligned stack, 48px above the bottom edge, 24px between parts:
  - the label: "Work in progress" and the odometer, Mono 11px +0.14em
  - the wordmark, width `min(68vw, 1000px)`
  - the two tagline lines as an outline (parent and child, with the guide line), Display 450 30/48
  - "Try it in your browser" (filled pill, `--field-ink` on `--field`) and "GitHub" (ghost pill)
  - the note "Runs in Chrome and Edge. Your notes never leave your device." in Text 15/24 at 72% ink
- The outlines settle in the space above and to the right of the stack.
- The canvas sits above the wordmark and below the text, so bullets swim over the logo but never over words.
- Mobile: the same stack, wordmark full width minus 60px, tagline 22/36.

## Diagrams

Diagrams are outlines with wires. Bullets are the nodes (12px for steps, 7px for details), 1px lines at 35% ink are the wires, titles are Display 450 15px, details are Text 14px set as an outline hanging from the node, and labels on wires are Commit Mono 11px in a pill. One path is drawn in `--rust` (1.5px) to show the thing being explained, like one edit going from keystroke to `updates/mac/0195.loro`. Straight lines, right angles, no boxes, no icons, no gradients. Draw them as SVG so the site can grow the rust path in with `spring.slow` when it scrolls into view.

## Page grammar

Logseq's 2021 site, cut down: a hero; "your notes stay yours" (local files, the edit log); three features, each a short outline beside a real screenshot from `docs/screenshots` (light and dark through `<picture>`); where the project stands (the roadmap as an outline, with the commit count); footer. Only real screenshots of the real app, never drawn mockups or visualizations of features that don't exist.

## Files

```
brand/
├ BRAND.md          this
├ references.md     what from Bassim's saves and the reference sites shaped each decision
├ specimen.html     the system, with the hero running live (open it in Chrome)
├ hero.js           the hero simulation, createSchool(canvas, options)
├ render.mjs        bun render.mjs → shots/ and og/og.png (headless Chrome)
├ fonts/            Wix Madefor Display, Wix Madefor Text, Commit Mono (woff2, OFL)
├ logo/
│ ├ gen.mjs         bun logo/gen.mjs regenerates every file below from src/
│ ├ src/            Wix Madefor Display 800 (the logo's source outlines) + OFL
│ ├ wordmark.svg  wordmark-dark.svg  wordmark-mono.svg
│ ├ mark.svg      mark-dark.svg      mark-mono.svg
│ ├ lockup.svg    lockup-dark.svg    lockup-mono.svg
│ ├ app-icon.svg  app-icon-mono.svg
│ ├ favicon.svg  favicon-32.png  apple-touch-icon.png  icon-512.png
│ └ explore-a-outline.svg  explore-b-bullet-q.svg  explore-c-numero.svg
├ og/               og.html (source) → og.png, 1200 × 630
└ shots/            specimen-{light,dark}.png and hero-{light,dark}.png at 2x
```

`-mono` files use `currentColor`; `-dark` files are drawn in `#F1EAE3` for dark backgrounds. `favicon.svg` and the PNGs are the apricot tile, which works on light and dark tabs. `apple-touch-icon.png` is full-bleed because iOS rounds it.
