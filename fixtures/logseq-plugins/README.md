# Logseq plugins for the plugin flows

Real Logseq marketplace plugins, exactly as the marketplace serves them, so `tools/e2e/flows/plugins.e2e.ts` runs them without the network. Each folder keeps its plugin's own `LICENSE` (all MIT).

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

- `plugins.json` and `stats.json`: those entries from `logseq/marketplace`, plus one desktop-only (`effect`) plugin that the web marketplace hides.
- `packages/<owner>__<repo>.json`: what `https://plugins.logseq.io/r2/<owner>/<repo>` answers.
- `files/<owner>/<repo>/<version>/`: what `https://pub-80f42b85b62c40219354a834fcf2bbfa.r2.dev/<owner>/<repo>/<version>/` serves.
- `jsdelivr/npm/@logseq/libs`: what `https://cdn.jsdelivr.net/npm/@logseq/libs` serves (0.0.17), for packages like Catppuccin whose `index.html` loads the SDK from there.

`tools/e2e/src/plugins.ts` routes those URLs, and seqno's own `lsp/<owner>/<repo>/<version>/` copy of the mirror, to these files.
