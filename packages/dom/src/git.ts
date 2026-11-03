import type { Table } from "./names.ts"

export interface GitParts {
  readonly "seqno-git-input": readonly []
  readonly "seqno-git-commit-message": readonly []
  readonly "seqno-git-run-command": readonly []
  readonly "seqno-git-seconds": readonly []
  readonly "seqno-git-tip": readonly []
}

export const gitParts: Table<GitParts> = {
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/git.cljs#L27
  "seqno-git-input": () => ({ className: "form-input" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/commit.cljs#L85
  "seqno-git-commit-message": () => ({ className: "form-input", id: "commit-message" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/shell.cljs#L34
  "seqno-git-run-command": () => ({ className: "form-input", id: "run-command" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/settings.cljs#L280
  "seqno-git-seconds": () => ({ className: "form-input is-small", id: "home-default-page" }),
  // https://github.com/logseq/logseq/blob/0.10.9/src/main/frontend/components/settings.cljs#L762
  "seqno-git-tip": () => ({ className: "admonitionblock tip" }),
}
