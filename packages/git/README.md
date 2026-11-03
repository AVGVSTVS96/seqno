# @seqno/git

Real git over a graph's markdown files, in the browser, with isomorphic-git. It's Logseq desktop's version control: auto commits, the commit dialog's status, page history and the `git` commands plugins send through `logseq.Git.execCommand`.

## What's inside

| Export                          | What it does                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeGit(options)`              | The Effect API the core worker uses: `run(args)`, `status`, `commitAll(message)`, `history(path)`, `show(oid, path)`, `identity`, `setIdentity`. One operation at a time. |
| `makeRepo(options)`             | The operations underneath: init, stage everything (`git add -A`), commit, `status --porcelain`, a file's log, a blob at a commit, and two-tree diffs.                     |
| `makeCli(repo, graphPath)`      | Runs git's command line: `{ stdout, stderr, exitCode }` the way dugite returns them to Logseq.                                                                            |
| `@seqno/git/browser` `handleFs` | isomorphic-git's file system over two File System Access folders: the graph folder is the work tree, and `/.git` maps to whichever folder holds the git directory.        |
| `lockIndex(gitdir)`             | Takes `.git/index.lock` the way git does, so seqno and Logseq desktop's git never write one index at once. Returns `null` while someone else holds it.                    |

- A commit with an empty message is "Auto saved by Logseq", as in Logseq. With nothing staged it's `NothingToCommit`, and with no `user.name`/`user.email` it's `NoIdentity` (git's "Author identity unknown").
- `user.name` and `user.email` come from the repo's `.git/config`, then from `globals`, the device-wide stand-in for `~/.gitconfig` (`git config --global` writes there).
- Commands: `init`, `status` (`--porcelain`, `-s`, long), `add` (`-A`, `.`, `./*`, `-u`, paths), `commit` (`-m`, `-a`, `--allow-empty`), `log` (`-n`, `--oneline`, `--pretty`/`--format` placeholders, `--date`, `-p`, `--name-only`, paths, `A..B`), `show` (`rev`, `rev:path`), `diff` (work tree, `--cached`, `A B`, `A..B`, `--name-only`, `--quiet`), `rev-parse`, `rev-list --count`, `update-ref`, `config`, `branch`, `ls-files`, plus `-C <graph>` and `-c key=value`.
- There are no remotes. `fetch`, `push`, `pull`, `merge @{u}`, `rebase @{u}` and their `--abort`s answer exactly as git does in a repo with no remote, so GitSeq reports "No upstream branch configured".
- Anything else answers `fatal: seqno runs git in the browser and can't run 'git <command>'` with exit code 128.
- The browser entry sets a global `Buffer`, which isomorphic-git needs.

## Tests

`test/cli.test.ts` runs each command on a temp folder next to the system `git` and checks the two answers are byte for byte the same, and that real git reads seqno's commits (`fsck --strict`, clean `status`). `test/browser.test.ts` drives headless Google Chrome over OPFS folders, so Chrome has to be installed.

```sh
pnpm test --project @seqno/git
```

## Known gaps

- No remotes: no clone, fetch, push or pull.
- No merges, rebases, resets, checkouts or conflict tools (`checkout-index`, `merge-file`, `update-index`, `hash-object`).
- `.gitattributes` filters and line-ending conversion aren't applied.
- Hunks come from jsdiff's Myers diff; on unusual edits git's own heuristics can split them differently.
