export { makeCli, type Cli, type Result } from "./cli.ts"

export { patch, type Change, type Side } from "./diff.ts"

export { formatDate, type CommitInfo, type Person } from "./format.ts"

export {
  dir,
  gitdir,
  makeRepo,
  type Committed,
  type FsClient,
  type Globals,
  type Identity,
  type Repo,
  type RepoOptions,
  type Target,
  type Version,
} from "./repo.ts"

export { GitFailed, makeGit, type Git, type GitOptions } from "./git.ts"
