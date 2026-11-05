import { Context, Effect, Layer, Option, PubSub, Schema, Stream, SubscriptionRef } from "effect"
import { makeGit } from "@seqno/git"
import type { FsClient, Git, Globals } from "@seqno/git"
import { GitFailed, GitSettings, defaultGitSettings } from "@seqno/rpc"
import type { GitNotice } from "@seqno/rpc"
import type { Storage } from "@seqno/vault"
import { ignoreSeqnoFiles } from "./mirror.ts"

export interface GitPlace {
  readonly fs: FsClient
  readonly lock: () => Promise<(() => Promise<void>) | null>
  readonly graphPath: string
}

export interface DeviceFile {
  readonly read: Effect.Effect<string | null>
  readonly write: (text: string) => Effect.Effect<void, GitFailed>
}

export class GitDevice extends Context.Service<
  GitDevice,
  {
    readonly settings: SubscriptionRef.SubscriptionRef<GitSettings>
    readonly setSettings: (settings: GitSettings) => Effect.Effect<void, GitFailed>
    readonly globals: Globals
    readonly notices: PubSub.PubSub<GitNotice>
  }
>()("@seqno/web/worker/GitDevice") {}

const SettingsJson = Schema.fromJsonString(GitSettings)
const ConfigJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))

export const layerGitDevice = (files: {
  readonly settings: DeviceFile
  readonly config: DeviceFile
}) =>
  Layer.effect(
    GitDevice,
    Effect.gen(function* () {
      const stored = yield* files.settings.read

      const settings = yield* SubscriptionRef.make(
        Option.getOrElse(
          Schema.decodeUnknownOption(SettingsJson)(stored ?? ""),
          () => defaultGitSettings,
        ),
      )

      const notices = yield* PubSub.unbounded<GitNotice>()

      const readConfig = Effect.map(files.config.read, (text) =>
        Option.getOrElse(Schema.decodeUnknownOption(ConfigJson)(text ?? ""), () => ({})),
      )

      return GitDevice.of({
        settings,
        notices,
        setSettings: (next) =>
          Effect.andThen(
            files.settings.write(Schema.encodeSync(SettingsJson)(next)),
            SubscriptionRef.set(settings, next),
          ),
        globals: {
          read: async () => await Effect.runPromise(readConfig),
          write: async (config) => {
            await Effect.runPromise(
              Effect.orDie(files.config.write(Schema.encodeSync(ConfigJson)(config))),
            )
          },
        },
      })
    }),
  )

export const layerGitDeviceMemory = layerGitDevice({
  settings: { read: Effect.succeed(null), write: () => Effect.void },
  config: { read: Effect.succeed(null), write: () => Effect.void },
})

export interface GraphGit {
  readonly git: Git
  readonly touched: (paths: readonly string[]) => Effect.Effect<void>
  readonly loadIgnore: Effect.Effect<string, GitFailed>
  readonly saveIgnore: (text: string) => Effect.Effect<void, GitFailed>
  readonly version: (path: string, oid: string) => Effect.Effect<string, GitFailed>
  readonly closing: Effect.Effect<void>
}

const ignoreFile = ".gitignore"

const failed = (error: { readonly _tag: string }) =>
  new GitFailed({ reason: "reason" in error ? String(error.reason) : error._tag })

const hint =
  "\nIf you don't want to see those errors or don't need git, you can disable the \"Git auto commit\" feature on Settings > Version control."

export const openGit = (
  place: GitPlace,
  storage: Storage["Service"],
  mayWrite: Effect.Effect<boolean>,
) =>
  Effect.gen(function* () {
    const device = yield* GitDevice

    if (yield* mayWrite) {
      yield* ignoreSeqnoFiles(storage)
    }

    const git = yield* makeGit({
      fs: place.fs,
      globals: device.globals,
      lock: place.lock,
      graphPath: place.graphPath,
    })

    const pending = new Set<string>()
    const unstaged = { everything: false }

    const touched = (paths: readonly string[]) =>
      Effect.sync(() => {
        for (const path of paths) {
          if (path === "") {
            unstaged.everything = true
          } else if (path !== ".git" && !path.startsWith(".git/")) {
            pending.add(path)
          }
        }
      })

    const taken = () => {
      const paths = unstaged.everything ? undefined : [...pending]
      pending.clear()
      unstaged.everything = false

      return paths
    }

    const putBack = (paths: readonly string[] | undefined) =>
      Effect.andThen(
        paths === undefined ? Effect.sync(() => (unstaged.everything = true)) : touched(paths),
        Effect.void,
      )

    const autoCommit = Effect.gen(function* () {
      if (!(yield* mayWrite)) {
        return
      }

      const paths = taken()
      yield* git.commitAll("", paths).pipe(
        Effect.flatMap((done) =>
          done._tag === "NoIdentity"
            ? Effect.andThen(
                putBack(paths),
                PubSub.publish(device.notices, { _tag: "IdentityNeeded" }),
              )
            : done._tag === "Busy"
              ? putBack(paths)
              : Effect.void,
        ),
        Effect.catch((error) =>
          Effect.andThen(
            putBack(paths),
            PubSub.publish(device.notices, {
              _tag: "CommitFailed",
              reason: `${error.reason}${hint}`,
            }),
          ),
        ),
      )
    })

    const every = (seconds: number) =>
      Effect.andThen(
        Effect.sleep("100 millis"),
        Effect.forever(Effect.andThen(autoCommit, Effect.sleep(`${seconds} seconds`))),
      )

    yield* Effect.forkScoped(
      SubscriptionRef.changes(device.settings).pipe(
        Stream.map((settings) => (settings.autoCommit ? settings.seconds : 0)),
        Stream.changes,
        Stream.switchMap((seconds) =>
          seconds === 0 ? Stream.empty : Stream.fromEffect(every(seconds)),
        ),
        Stream.runDrain,
      ),
    )

    const closing = Effect.flatMap(SubscriptionRef.get(device.settings), (settings) =>
      settings.autoCommit && settings.commitOnClose ? autoCommit : Effect.void,
    )

    yield* Effect.addFinalizer(() => closing)

    const encoder = new TextEncoder()

    const graphGit: GraphGit = {
      git,
      touched,
      closing,
      loadIgnore: storage.read(ignoreFile).pipe(
        Effect.map((bytes) => new TextDecoder().decode(bytes)),
        Effect.catchTag("FileUnavailable", () =>
          Effect.as(Effect.mapError(storage.write(ignoreFile, encoder.encode("")), failed), ""),
        ),
        Effect.mapError(failed),
      ),
      saveIgnore: (text) =>
        Effect.mapError(storage.write(ignoreFile, encoder.encode(text)), failed),
      version: (path, oid) =>
        Effect.flatMap(git.run(["show", `${oid}:${path}`]), (shown) =>
          shown.exitCode === 0
            ? Effect.succeed(shown.stdout)
            : Effect.fail(new GitFailed({ reason: shown.stderr.trim() })),
        ),
    }

    return graphGit
  })
