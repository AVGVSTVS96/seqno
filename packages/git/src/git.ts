import { Effect, Schema, Semaphore } from "effect"
import { makeCli } from "./cli.ts"
import type { Result } from "./cli.ts"
import { makeRepo } from "./repo.ts"
import type { Committed, RepoOptions, Version } from "./repo.ts"

export class GitFailed extends Schema.TaggedError<GitFailed>()("GitFailed", {
  reason: Schema.String,
}) {}

export interface Git {
  readonly run: (args: readonly string[]) => Effect.Effect<Result>
  readonly commitAll: (
    message: string,
    only?: readonly string[],
  ) => Effect.Effect<Committed, GitFailed>
  readonly history: (path: string) => Effect.Effect<readonly Version[], GitFailed>
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
          Effect.promise(
            async () =>
              await cli(args).catch((error: unknown) => ({
                stdout: "",
                stderr: `fatal: ${error instanceof Error ? error.message : String(error)}\n`,
                exitCode: 128,
              })),
          ),
        ),
      commitAll: (message, only) => serial(async () => await repo.commitAll(message, only)),
      history: (path) => serial(async () => await repo.history(path)),
    }
  })
