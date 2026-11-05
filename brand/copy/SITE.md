# seqno site copy

Final copy. Use it word for word. Text in `code` shows as code. Notes in _(italics)_ are for the designer, not the page. Anything tagged **next** or **later** isn't built yet and has to look it (muted, with a small mono tag).

The page is buzz.xyz's hero on top of a cut-down Logseq 2021 homepage, in this order and nothing more:

```
hero          label + live number, wordmark, two lines, two buttons
screenshot    the app, with one caption                  (Logseq 2021: the hero screenshot)
note          two sentences from bassim                  (Logseq 2021: "Why logseq?")
features      four blocks, picture beside words          (Logseq 2021: the gif rows)
built with    one line
roadmap       now / next / later, one line of advice     (Logseq 2021: "Ready to dive in?")
footer
```

About 280 words of page copy in total, counting the repeated buttons and the footer. If a section grows, cut words, not sections.

## Page

- `<title>`: seqno · a local-first outliner
- Meta description: A local-first outliner that looks and feels like Logseq and opens your Logseq graphs. A work in progress you can try in your browser.
- `og:title`: seqno
- `og:description`: A local-first outliner, rebuilt to be minimal, solid and clean. Work in progress: try it in your browser.
- OG image: the wordmark, the label WORK IN PROGRESS, and "A local-first outliner, rebuilt to be minimal, solid and clean." _(No build number on the OG image. It's a still picture, so the number would go stale.)_

## Hero

_(Buzz's hero: a huge lowercase wordmark, a tiny mono label, two short lines, two buttons. The top edge of the screenshot can peek in below; nothing else is above the fold.)_

### Headline

The wordmark is the headline people see. The first line under it is the headline that explains it. Options for that line:

1. **A local-first outliner, rebuilt to be minimal, solid and clean.** ← pick
2. An outliner that looks and feels like Logseq, and opens your Logseq graphs.
3. My favorite outliner, rebuilt to be minimal, solid and clean.
4. A local-first outliner, as minimal, solid and clean as I can make it.
5. Outlines on your own devices, merged without conflicts.

Why 1: it's the README's own one-liner ("a local-first outliner") plus the three things Bassim is going for, in his words. "Rebuilt" carries the story quietly without naming anyone, and the screenshot caption right below answers "rebuilt from what?". 2 is the strongest hook for Logseq users, but it leads with someone else's name and makes seqno sound like a copy, so it works better as the caption, where it is. 3 and 4 are the warmest, but their "my" and "I" arrive before we've met Bassim. 5 leads with a promise that is still partly **next** (two real devices).

### Tagline

The two lines under the wordmark, in this order:

> A local-first outliner, rebuilt to be minimal, solid and clean.
> It's early, so keep your real notes where they are for now.

_(One line each on desktop, like Buzz's "Where people and agents work together. / Come test the early stages with us." Let each wrap naturally on phones.)_

Runners-up for the second line:

- It's early. Come try it in your browser.
- It's early, so don't move your notes in yet.
- A work in progress, built in the open.

Why the pick: it's the honest status (not ready for real notes) said the way a friend would say it, and it leaves the inviting to the button right under it.

### Label and live number

This is the work-in-progress element. It's one line of mono above the wordmark, in Buzz's DEVELOPER PREVIEW spot (and Logseq 2021's "Beta testing" pill).

```
WORK IN PROGRESS · NO. 192
```

- **WORK IN PROGRESS** is static.
- **NO. 192** is the live number of commits on seqno's `main`. "No." is the "no" in seqno: sequence number, seq. no. It links to github.com/AVGVSTVS96/seqno/commits/main.

Tooltip, on hover and on keyboard focus (sentence case, never uppercase, so seqno stays lowercase):

> 192 changes so far, the last one 3 hours ago. Every edit you make in seqno gets a number like this in its edit log. That's the name: seqno, short for sequence number.

How "the last one … ago" reads: just now · 4 minutes ago · an hour ago · 3 hours ago · yesterday · 4 days ago · on Oct 6.

_(The number is always real. Bake the count in at build time and fetch the live one on load. If the live count is higher, roll the digits once from the baked number to the new one; that's the only motion it ever makes. If the fetch fails, show the baked number and drop "the last one … ago" from the tooltip. Never tick it up on a timer.)_

_(If the design wants the label and the number apart, the number can sit alone as a thin strip at the bottom of the hero: `no. 192 · updated 3 hours ago`, lowercase, same tooltip.)_

### Buttons

- Primary: **Try it in your browser** _(the live web app)_
- Secondary: **GitHub** _(github.com/AVGVSTVS96/seqno)_

Under the buttons, small:

> Runs in Chrome and Edge. Your notes never leave your device.

On Safari or Firefox, swap that line for:

> seqno runs in Chrome and Edge for now. Open this page in one of them to try it.

On an iPhone or iPad, swap it for:

> Try it on a computer for now, in Chrome or Edge. The iOS app comes later.

_(The app itself doesn't warn Safari and Firefox yet, so the site has to.)_

## Screenshot

_(The showcase screenshot, `showcase-light.png` or `showcase-dark.png` to match the visitor's system, large, in a window frame. This is Logseq 2021's big hero screenshot.)_

Caption:

> Looks and feels like Logseq, and opens your Logseq graphs.

Alt text: A seqno page with properties, headings, links, tags and nested blocks

## Note

_(Bassim's words from the README, unchanged. Set quietly: a narrow column, normal text size, signed. No heading. Keep Logseq out of this block; the caption above is enough.)_

> A couple of years ago I watched my favorite note-taking app get worse and worse, so I decided to rebuild it on a stack of really nice technologies. The goal is to keep it as minimal as possible while making it as solid and clean as I can.
>
> — bassim

_(Link "bassim" to github.com/AVGVSTVS96.)_

## Features

_(Four rows, picture on one side and words on the other, alternating sides, like Logseq 2021's gif rows. Each row is one line and one sentence. Pictures are real screenshots or short silent loops of the real app, light and dark to match the visitor.)_

### Every page is an outline.

Indent, drag, fold or zoom into any block, and start each day on a fresh journal page.

_(Loop: the Structure section of the Showcase page. Tab, Shift+Tab, a drag, a fold, a zoom.)_

Alt text: Blocks being indented, moved and folded on a seqno page

### Links go both ways.

Type `[[` to link any page, and that page shows every block that links back, even the ones that only mention it.

_(`editing-dark.png` / `editing-light.png`: the `[[Gar` popup. Or a loop that ends on `sidebar-*.png`, the page and its references.)_

Alt text: Linking a page while typing, and the page's references in the sidebar

### Queries stay live.

Logseq's simple queries run unchanged, and their results update as you type.

_(New capture needed: the Queries section of the Showcase page, `{{query (task NOW DOING)}}` and its results. A loop is better: mark a task DOING and watch it join the results. The design harness has a showcase-queries scene to start from.)_

Alt text: A query block listing tasks, updating as one changes

### Your notes stay on your device.

There's no seqno server, and every edit goes into a log built to merge across devices without conflicts.

**next** Two Macs, one graph, through iCloud Drive.

_(Not a screenshot. The graph folder in mono, with update files appearing as someone types. The numbers in the file names are the name of the app, so let them be seen.)_

```
my-graph/
  journals/  pages/  logseq/  assets/
  updates/web-3f9a1c07e2b/
    0.loro  412.loro  577.loro  809.loro
```

Alt text: A graph folder with Logseq's files and seqno's numbered edit files

## Built with

> Built with TypeScript 7, Effect 4, Loro, SQLite, React 19, CodeMirror 6 and Vite 8.

_(One line, small. Each name links to its site: typescriptlang.org, effect.website, loro.dev, sqlite.org/wasm, react.dev, codemirror.net, vite.dev.)_

## Roadmap

_(Mono label, then three rows. "now" in the text color; "next" and "later" muted.)_

Label: ROADMAP

```
now     The web app, in Chrome and Edge.
next    Safe for big, real graphs, with edits written back to Logseq markdown.
later   iOS with iCloud Drive, and a desktop app.
```

> Trying it with a Logseq graph? Use a copy for now.

Link, small: **Read the roadmap, known gaps and all** _(github.com/AVGVSTVS96/seqno/blob/main/docs/roadmap.md)_

Buttons again: **Try it in your browser** · **GitHub**

## Footer

- seqno · MIT
- github.com/AVGVSTVS96/seqno
- by [bassim](https://github.com/AVGVSTVS96)
- Not affiliated with Logseq.

## Motion

_(Short, so the site and the launch video move the same way. Match the brand's easing once `brand/` lands.)_

- On load the hero builds once, top to bottom: the label, the wordmark, line one, line two, the buttons. Each part rises a few pixels and fades in. No loop, no parallax.
- The live number rolls only when the real count changes.
- Feature loops start when they scroll into view and play once. They don't autoplay offscreen.
- The update files in the fourth feature appear one at a time, the way the vault writes them while someone types.
- With reduced motion on, everything is simply there.
