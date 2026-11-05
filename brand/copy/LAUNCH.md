# seqno launch

The X post, its follow-up thread, and the launch video. The post and thread are in Bassim's own voice: lowercase, plain, honest about where it is. The links go in the first reply so the post itself gets the reach.

Everything here is true today per the seqno docs. Swap `<live url>` for the web app's address before posting.

## The post

*(Long post. Attach the launch video, or `showcase-dark.png` if the video isn't ready.)*

```
introducing seqno, a local-first outliner

a couple of years ago i watched my favorite note-taking app get worse and worse, so i decided to rebuild it on a stack of really nice technologies

the goal is to keep it as minimal as possible while making it as solid and clean as i can

- looks and feels like logseq, and opens your logseq graphs
- no account, no seqno server. your notes stay on your device
- every edit goes into a crdt log built to merge across devices without conflicts
- typescript 7, effect 4, loro, sqlite, react 19, codemirror 6 and vite 8. mit

it's a work in progress: web only for now (chrome and edge), and not ready for your real notes yet. but the demo runs right in your browser
```

If it has to fit in 280 characters:

```
introducing seqno: a local-first outliner, rebuilt to be minimal, solid and clean

looks and feels like logseq and opens your logseq graphs. no account, no seqno server, your notes stay on your device

a work in progress, web only for now. try the demo in your browser
```

## The thread

Five replies, in this order.

**1. Links**

```
try it: <live url>
chrome or edge. a demo graph runs in your browser, and your notes never leave your device

code: github.com/AVGVSTVS96/seqno
```

**2. The name**

```
the name: seqno = sequence number

every edit seqno saves gets a number in its edit log. each device writes only its own files, named by those numbers, so two devices never fight over the same file

updates/web-3f9a1c07e2b/0.loro
updates/web-3f9a1c07e2b/412.loro
updates/web-3f9a1c07e2b/577.loro
```

**3. Sync**

```
sync is the part that can lose your notes, so it has its own simulator: 5 devices against a fake icloud built to misbehave

late notices, files listed before they download, evictions, conflict copies, devices offline for up to a day and a half, clocks off by 2 hours

1,000 runs of 1k edits and 100 runs of 10k edits. 0 lost

next: sync on two real macs
```

**4. Queries**

*(Attach a screenshot of the query block and its results from the Showcase page.)*

```
logseq's simple queries paste in and run unchanged, and stay live as you type. dataview-style works too

"todos not under a doing task" needs an advanced query in logseq: 20 lines of datalog rules. in seqno it's one line:

{{query (and (task todo) (not (under (task doing))))}}
```

**5. Clean, and what's next**

```
solid and clean, in practice: lint fails on code comments, `as` casts, `any` and useEffect, and ~490 unit tests and 56 browser flows run against a production build

next: making it safe for big, real graphs, and writing edits back as logseq markdown. then ios with icloud drive, and desktop

the roadmap, known gaps and all: github.com/AVGVSTVS96/seqno/blob/main/docs/roadmap.md
```

## Launch video, about 85 seconds

Bassim reads the voiceover in his own voice, unhurried. The picture is the real app and the site, in the site's look, moving the way the site moves (see Motion in `SITE.md`): parts rise in once, nothing loops, numbers roll only when something real changes. The voiceover is burned in as captions, because most people watch muted. In beats 01 and 02 the captions are the blocks being typed.

One thread runs through the whole video: a small mono counter in the top right, `no. 0`, that counts every edit typed on screen. It's the real count from the recording (read it from the session's update file names afterwards), and in beat 09 it turns out to be the name.

| # | time | picture | voiceover |
|---|---|---|---|
| 01 | 0:00 | Today's journal in seqno, light. One empty block, cursor blinking. As Bassim speaks, his words type into the block. The counter starts rolling. | A couple of years ago, I watched my favorite note-taking app get worse and worse. |
| 02 | 0:06 | Enter, Tab. His next line types into a child block. | So I decided to rebuild it, on a stack of really nice technologies. |
| 03 | 0:11 | Cut to the site's hero. The label, then the huge wordmark, then the first line rise in, exactly as on the site. | This is seqno. |
| 04 | 0:15 | The Showcase page fades in and scrolls slowly: properties, headings, links, tags. | It looks and feels like Logseq, and it opens your Logseq graphs. |
| 05 | 0:21 | The Structure section. Tab, Shift+Tab, a drag, a fold, a zoom. Each key shows briefly as a mono chip, bottom left. | Every page is an outline. Indent, drag, fold or zoom into any block. |
| 06 | 0:28 | Back on the journal: `[[Gar`, the popup offers Garden Plan, Enter. Garden Plan opens in the right sidebar with its linked references. | Type two brackets to link a page, and that page shows everything that links back. |
| 07 | 0:35 | The Queries section: `{{query (task NOW DOING)}}` and its results. Above it, a TODO becomes DOING, and it joins the results. | Logseq's simple queries run unchanged, and stay live as you type. |
| 08 | 0:42 | No voice, just the music. Mod+K, "greenhouse", results fill in as the word is typed. | |
| 09 | 0:46 | The app slides left. On the right, the graph folder in mono. As a block is typed, update files appear one by one: `0.loro`, `412.loro`, `577.loro`. The corner counter moves to the center beside them and reads `seq. no.`, then closes up into `seqno`. | Every edit seqno saves gets a number in its edit log. A sequence number. That's the name. |
| 10 | 0:55 | A second device's column of files appears beside the first, and both flow into one page. A small mono tag: `next · two Macs, one graph, through iCloud Drive`. | Those logs are built to merge across devices without conflicts, and there's no seqno server. |
| 11 | 1:03 | The built-with names rise one at a time in one mono line: TypeScript 7 · Effect 4 · Loro · SQLite · React 19 · CodeMirror 6 · Vite 8. | The goal is to keep it as minimal as possible, while making it as solid and clean as I can. |
| 12 | 1:10 | The site's roadmap rows: now, next, later. | It's a work in progress. Web only for now, in Chrome and Edge. iOS and desktop come later. And it's not ready for your real notes yet. |
| 13 | 1:19 | The whole hero, as on the site. The label's number rolls up to today's real commit count. The button, the address, github.com/AVGVSTVS96/seqno. Hold for two seconds of quiet. | But you can try it today, right in your browser. Your notes never leave your device. |

**60-second cut:** drop 05 and 08, and end 12 after "Web only for now, in Chrome and Edge."

*(Record on the Showcase graph, `fixtures/graphs/showcase`, with its journal dates moved to launch day. That isn't the demo graph visitors get today, which is three short pages. Either ship the Showcase graph as the demo before launch, or keep the video from implying it's what they'll open.)*

*(Sound: soft key clicks under the typing, quiet music under the voice, nothing on the counter. No whooshes.)*
