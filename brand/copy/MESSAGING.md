# seqno messaging

The source of truth for how we talk about seqno. The site, the README, the launch post and the video all draw from here. When something here and something there disagree, fix it here first.

Every claim here is true today per the seqno repo's `README.md`, `docs/architecture.md`, `docs/decisions.md` and `docs/roadmap.md` (as of Oct 8 2026). "Next" and "later" are used only for what the roadmap lists.

## One line

**seqno is a local-first outliner that looks and feels like Logseq, rebuilt to be minimal, solid and clean.**

Shorter, for a bio, a card or the repo description: **A local-first outliner, rebuilt to be minimal, solid and clean.**

## The story

It's Bassim's, in his words. Keep them close; trim, don't rephrase.

> A couple of years ago I watched my favorite note-taking app get worse and worse, so I decided to rebuild it on a stack of really nice technologies. The goal is to keep it as minimal as possible while making it as solid and clean as I can.

Three things carry it:

1. **Someone who loved a tool watched it slip.** Say it once, plainly, and move on. No villain, no details, no "bloated", "slow" or "abandoned".
2. **So he rebuilt it, on technology he enjoys.** "A stack of really nice technologies" is the line, and the built-with list is the proof: TypeScript 7, Effect 4, Loro, SQLite, React 19, CodeMirror 6, Vite 8.
3. **The goal is restraint and care.** As minimal as possible, as solid and clean as he can make it. That's the whole pitch. Everything else is evidence for it.

**Never name the app that got worse.** Don't put Logseq in the same sentence as the story, and don't hint ("you know which one"). Elsewhere, naming Logseq is fine and useful: seqno looks and feels like Logseq, and opens Logseq graphs. Say it as a compliment, because it is one.

## Three pillars

### 1. An outliner that feels like home

If you've used Logseq, you already know how to use seqno.

- **It looks and feels like Logseq.** Every color, size and space in the design spec was measured from Logseq itself, and a design harness puts 12 screens next to Logseq, in light and dark.
- **It opens your Logseq graphs.** Pick a Logseq folder and seqno reads its journals and pages, with the name and date formats in its `config.edn`.
- **The habits carry over.** Journals with today on top, `[[links]]`, tags, aliases, properties, tasks with SCHEDULED and DEADLINE, block references, embeds, Mod+K search, the right sidebar, and Logseq's simple queries, which paste in and run unchanged.

Don't say: "pixel-perfect", "a drop-in replacement", "fully compatible", "works alongside Logseq". seqno reads your markdown when it first opens a folder, but doesn't write edits back yet, so Logseq won't see them (that's next).

### 2. Your notes on your devices, merged without conflicts

No account, and no seqno server. Your notes stay on your device.

- **Every edit goes into an edit log** (a Loro CRDT) built so devices merge without conflicts. Two devices typing in one block merge letter by letter, and a block moved on two devices ends up in one place.
- **Sync is built to go through a folder you already have,** like one in iCloud Drive. The operating system copies the files; seqno only reads and writes them. Each device writes only its own files, so there's nothing to fight over.
- **It has been tested hard, in a simulator.** 5 devices against a deliberately hostile fake iCloud: late notices, files listed before they download, evicted files, conflict copies, devices offline for up to a day and a half, clocks off by 2 hours. 1,000 runs of 1k edits and 100 runs of 10k edits, 0 lost.
- **SQLite is only an index.** It runs in a worker, is never synced, and can always be rebuilt from the edit log.

Status, always said with it: **syncing two real devices is next.** The sync engine has passed the simulator and folder tests, but not a run on two computers.

Don't say: "syncs across all your devices", "never loses data", "encrypted", "secure", "private by design". Say what the code does.

### 3. Minimal, clean and open

- **Minimal.** It's an outliner and nothing else, and the goal is to keep it as minimal as possible. Plenty of Logseq isn't here (flashcards, graph view, plugins).
- **Clean, and enforced.** Lint fails on code comments, `as` casts, `any` and `useEffect`. Every boundary is decoded with a schema. About 490 unit and component tests and 56 browser flows run against a production build.
- **Open.** MIT. The docs explain why every piece was picked, with the numbers behind it, and the roadmap lists the known gaps.

Don't quote a line count; the docs don't give one. Don't say "lightweight" or "tiny".

## What it is

- A local-first outliner, in the browser today: Chrome and Edge.
- A TypeScript rebuild that looks and feels like Logseq and opens Logseq graphs.
- One person's project, built in the open, MIT.
- A demo graph you can try in your browser. Your notes never leave your device.

## What it isn't

- **Not ready for your real notes.** Yet. See the status below.
- **Not a fork of Logseq,** and not made by or affiliated with the Logseq team. It's a rebuild from scratch.
- **Not a cloud service.** No account, no seqno server, no sign-in.
- **Not two-way with Logseq yet.** Edits made in seqno stay in its edit log; writing them back as Logseq markdown is next.
- **Not everywhere yet.** No Safari or Firefox (they can't open a folder on disk). No phone or desktop app yet: iOS and desktop come later.
- **Not everything Logseq does.** No flashcards, graph view or plugins.

## Status, told honestly

It's a work in progress, and that's part of the charm, not something to hide. Say it early, say it plainly, and pair it with something you can do.

- **Three words:** Work in progress.
- **One line:** It's early: web only for now (Chrome and Edge), and not ready for your real notes yet.
- **With charm:** It's early, so keep your real notes where they are for now.
- **A paragraph:** seqno is a work in progress. The web app runs in Chrome and Edge, with journals, pages, links, queries, search and Logseq import all working on the real engine. It isn't ready for your real notes yet, and the roadmap says exactly why. Making it safe for big, real graphs is next. After that come iOS, with iCloud Drive, and a desktop app.

If someone asks why it isn't ready, these are the known gaps from the roadmap, in plain words:

- Closing the tab can drop the last quarter second of typing, and nothing shows when a save fails.
- Two devices that both start the day's journal before syncing can leave a graph that won't open.
- Edits made in seqno don't reach your Logseq markdown files yet.
- Big graphs are slow to bring in: importing 50k blocks took about 3 minutes.

Trying it with a Logseq graph? Use a copy. seqno keeps its edit log inside the folder you pick.

The order, from the roadmap: **now** the web app · **next** making it safe for big, real graphs · **later** iOS with iCloud Drive, and desktop (Electron).

## The name

**seqno is short for sequence number.** Every edit seqno saves gets a number in its edit log. Each device writes its edits to files named by those numbers:

```
updates/web-3f9a1c07e2b/0.loro
updates/web-3f9a1c07e2b/412.loro
updates/web-3f9a1c07e2b/577.loro
```

Explain it once, in a line, where a number is already on screen (the site's build number, the video's counter). Don't put it in a headline.

- **Always lowercase,** even at the start of a sentence, and even in uppercase labels: never let CSS or a caps style turn it into SEQNO. If a label is uppercase, keep the name out of it.
- Never "Seqno", "SeqNo", "SEQNO", "seq" or "sqno".

## Voice

Plain, direct, warm. Short sentences anyone can follow. The work is good; say what it does and let that be enough.

**Do**

- Use Bassim's words where they exist: "my favorite note-taking app", "a stack of really nice technologies", "as minimal as possible", "as solid and clean as I can".
- Say what's there, with the real names: journals, `[[links]]`, `{{query}}`, Mod+K, the edit log, iCloud Drive.
- Give real numbers, with what they measure: "a keystroke costs 0.14 ms in the engine", not "instant".
- Put the status next to the claim it limits: "built to merge across devices without conflicts. Two real devices are next."
- Sentence case on the site. Lowercase in posts in Bassim's own voice.

**Don't**

- No hype: powerful, seamless, revolutionary, supercharge, blazing, lightning-fast, next-gen, game-changing, beautiful (let the screenshot say it).
- No category jargon: second brain, PKM, knowledge platform, tools for thought, productivity.
- No setup-and-punchline lines. A twist at the end of a sentence is what makes it sound like an ad.
- No digs at Logseq or its team. No "Logseq killer", "Logseq done right", "what Logseq should have been", "alternative" or "replacement".
- No fear. Don't sell local-first by describing what clouds do with your data.
- No emoji.

**Examples**

| Don't | Do |
|---|---|
| The powerful, privacy-first knowledge platform. | A local-first outliner. |
| Seamless sync across all your devices. | Every edit goes into a log built to merge across devices without conflicts. Two real devices are next. |
| Lightning fast. | A keystroke costs 0.14 ms in the engine, about 100 times under a 16 ms frame. |
| 100% Logseq compatible. | Opens your Logseq graphs. Logseq's simple queries run unchanged. |
| Logseq, but finally done right. | Looks and feels like Logseq, rebuilt to be minimal, solid and clean. |
| Beta! Join the waitlist. | It's early. Try it in your browser. |
| Military-grade privacy. | No account, no seqno server. Your notes stay on your device. |

## Facts we can use

Every number here is from the docs, with what it measures. Use the qualifier with the number.

| Fact | Where |
|---|---|
| Runs in Chrome and Edge; iOS and desktop come later | README, roadmap |
| Opens Logseq folders and reads `journals/`, `pages/` and `config.edn` formats | architecture |
| Edits save to the edit log every 250 ms and survive a reload | roadmap |
| Logseq's simple queries paste in and run unchanged; Dataview-style also works | architecture, roadmap |
| "TODOs not under a DOING task": 20 lines of Datalog rules in Logseq, one line here: `{{query (and (task todo) (not (under (task doing))))}}` | decisions |
| A keystroke costs 0.14 ms p95 in the engine on the web, on a 50k-block graph | decisions (phase 0 benchmark) |
| Sync simulator: 1,000 runs of 1k edits and 100 runs of 10k edits, 5 devices, 0 lost | decisions |
| Web and iOS applied the same 10k edits and ended identical | decisions (phase 0 benchmark) |
| About 490 unit and component tests, 56 Playwright flows against a production build | roadmap |
| 12 screens checked next to Logseq, light and dark | roadmap |
| Every design value measured from the live Logseq apps | design-spec |
| No seqno server; everything runs on your device | architecture |
| MIT | README |
