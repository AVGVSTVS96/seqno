import { Effect, Schema, Semaphore } from "effect"
import { makeCli, type Result } from "./cli.ts"
import { makeRepo, type Committed, type Identity, type RepoOptions, type Version } from "./repo.ts"

export class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", {
  reason: Schema.String,
}) {}

export interface Git {
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<Result>
  readonly status: Effect.Effect<string, GitFailed>
  readonly commitAll: (message: string) => Effect.Effect<Committed, GitFailed>
  readonly history: (path: string) => Effect.Effect<ReadonlyArray<Version>, GitFailed>
  readonly show: (oid: string, path: string) => Effect.Effect<string | null, GitFailed>
  readonly identity: Effect.Effect<Identity | null, GitFailed>
  readonly setIdentity: (identity: Identity) => Effect.Effect<void, GitFailed>
}

export interface GitOptions extends RepoOptions {
  readonly graphPath: string
}

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new GitFailed({ reason: cause instanceof Error ? cause.message : String(cause) }),
  })

export const makeGit = (options: GitOptions) =>
  Effect.map(Semaphore.make(1), (lock): Git => {
    const repo = makeRepo(options)
    const cli = makeCli(repo, options.graphPath, options.now)
    const serial = <A>(run: () => Promise<A>) => lock.withPermit(attempt(run))
    return {
      run: (args) =>
        lock.withPermit(
          Effect.promise(() =>
            cli(args).catch((cause: unknown) => ({
              stdout: "",
              stderr: `fatal: ${cause instanceof Error ? cause.message : String(cause)}\n`,
              exitCode: 128,
            })),
          ),
        ),
      status: serial(async () => {
        await repo.ensure()
        return repo.porcelain()
      }),
      commitAll: (message) => serial(() => repo.commitAll(message)),
      history: (path) => serial(() => repo.history(path)),
      show: (oid, path) => serial(() => repo.show(oid, path)),
      identity: serial(() => repo.identity()),
      setIdentity: ({ name, email }) =>
        serial(async () => {
          await repo.setGlobal("user.name", name)
          await repo.setGlobal("user.email", email)
        }),
    }
  })
