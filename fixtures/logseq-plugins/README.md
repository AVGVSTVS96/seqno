# Logseq plugins for the plugin flows

Real Logseq marketplace plugins, exactly as the marketplace serves them, so the `tools/e2e/flows/plugins*.e2e.ts` flows run them without the network. Each folder keeps its plugin's own `LICENSE` (all MIT).
Real Logseq marketplace plugins, exactly as the marketplace serves them, so `tools/e2e/flows/plugins.e2e.ts` runs them without the network. Each folder keeps its plugin's own `LICENSE` (MIT, and Apache 2.0 for DONE time).

| Folder                                         | Plugin                | Version  |
| ---------------------------------------------- | --------------------- | -------- |
| `files/xyhp915/logseq-journals-calendar`       | Journals calendar     | v0.11.1  |
| `files/benjypng/logseq-wordcount-plugin`       | Word count            | v2.4.3   |
| `files/haydenull/logseq-plugin-markdown-table` | Markdown Table Editor | v1.9.0   |
| `files/sawhney17/logseq-pomodoro-plugin`       | Pomodoro timer        | 1.0.3    |
| `files/pengx17/logseq-dev-theme`               | Dev theme             | v1.26.17 |
| `files/xyhp915/logseq-assets-plus`             | Assets plus           | v0.0.5   |
| `files/catppuccin/logseq`                      | Catppuccin            | v0.6.4   |
| `files/sethfair/logseq-atlas-theme`            | Atlas Theme           | v0.3.5   |
| `files/stdword/logseq-bujo-theme`              | Bullet Journal theme  | 1.4.6    |
| `files/pengx17/logseq-laurel-theme`            | Laurel theme          | v1.8.8   |
| `files/ZYJ-3721/logseq-pdf-translator`         | PDF Translator        | v0.2.0   |
| `files/tankcool/logseq-quick-capture`          | Quick Capture         | 0.0.7    |
| `files/QWxleA/log-stats`                       | Log-Stats             | 0.1.4    |
| `files/c6p/logseq-hypothesis`                  | Hypothesis            | v0.2.4   |
| `files/mjs/logseq-done-time`                   | DONE time             | v1.0     |
| `files/tankcool/logseq-random-note` | Random Note | 1.1.2 |
| `files/vipzhicheng/logseq-plugin-mark-map` | Markmap | v0.4.6 |
| `files/benjypng/logseq-mergepages-plugin` | logseq-mergepages-plugin | v2.0.0 |

- `plugins.json` and `stats.json`: those entries from `logseq/marketplace`, including two desktop-only (`effect`) plugins, which Logseq's web marketplace hides and its desktop app lists.
- `packages/<owner>__<repo>.json`: what `https://plugins.logseq.io/r2/<owner>/<repo>` answers.
- `files/<owner>/<repo>/<version>/`: what `https://pub-80f42b85b62c40219354a834fcf2bbfa.r2.dev/<owner>/<repo>/<version>/` serves.
- `jsdelivr/npm/@logseq/libs`: what `https://cdn.jsdelivr.net/npm/@logseq/libs` serves (0.0.17), for packages like Catppuccin whose `index.html` loads the SDK from there.
- `jsdelivr/gh/adobe-fonts/source-sans@3.046R/`: the stylesheet Dev theme imports from jsdelivr and its two WOFF2 files (SIL Open Font License, in `LICENSE.md`), so the theme's own font loads, offline too.

`tools/e2e/src/plugins.ts` routes those URLs, and seqno's own `lsp/<owner>/<repo>/<version>/` copy of the mirror, to these files.
