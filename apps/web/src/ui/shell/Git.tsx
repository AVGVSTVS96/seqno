import { RegistryContext, useAtom, useAtomMount, useAtomValue } from "@effect/atom-react"
import { Effect, Stream } from "effect"
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity"
import { useContext, useId, useState, type ReactNode } from "react"
import { logseq } from "@seqno/dom"
import { GitClient, type GitSettings } from "@seqno/rpc"
import { gitRuntime } from "../../atoms.ts"
import { SwitchButton } from "./Appearance.tsx"
import { notify } from "./Notices.tsx"
import { closeDialogOf, Dialog } from "./popover.tsx"

export type GitDialog =
  | { readonly _tag: "Commit" }
  | { readonly _tag: "Identity" }
  | { readonly _tag: "Run" }
  | { readonly _tag: "History"; readonly page: string }

export const gitDialog = Atom.make<GitDialog | null>(null).pipe(Atom.keepAlive)

const client = Effect.service(GitClient)

export const runGit = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  effect: Effect.Effect<A, E, GitClient>,
) =>
  Effect.runPromise(
    Effect.flatMap(AtomRegistry.getResult(registry, gitRuntime), (context) =>
      Effect.provide(effect, context),
    ),
  )

const reasonOf = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "reason" in cause
    ? String(cause.reason)
    : cause instanceof Error
      ? cause.message
      : String(cause)

export const gitSettings = gitRuntime
  .atom(Stream.unwrap(Effect.map(client, (git) => git.WatchGitSettings())))
  .pipe(Atom.keepAlive)

const gitNotices = gitRuntime
  .atom((get) =>
    Stream.unwrap(Effect.map(client, (git) => git.WatchGitNotices())).pipe(
      Stream.tap((notice) =>
        Effect.sync(() =>
          notice._tag === "IdentityNeeded"
            ? get.registry.set(gitDialog, { _tag: "Identity" })
            : notify(get.registry, notice.reason),
        ),
      ),
    ),
  )
  .pipe(Atom.keepAlive)

const commitOnClose = Atom.make((get) => {
  const closing = () =>
    void runGit(
      get.registry,
      Effect.flatMap(client, (git) => git.GitClosing()),
    ).catch(() => undefined)
  addEventListener("pagehide", closing)
  get.addFinalizer(() => removeEventListener("pagehide", closing))
}).pipe(Atom.keepAlive)

const gitStatus = gitRuntime
  .atom(
    Effect.map(
      Effect.flatMap(client, (git) => git.GitRun({ args: ["status", "--porcelain"] })),
      (result) => result.stdout,
    ),
  )
  .pipe(Atom.setIdleTTL(0))

const pageHistory = Atom.family((page: string) =>
  gitRuntime
    .atom(Effect.flatMap(client, (git) => git.GitHistory({ page })))
    .pipe(Atom.setIdleTTL(0)),
)

const versionText = Atom.family((spec: string) =>
  gitRuntime
    .atom(
      Effect.map(
        Effect.flatMap(client, (git) => git.GitRun({ args: ["show", spec] })),
        (result) => (result.exitCode === 0 ? result.stdout : ""),
      ),
    )
    .pipe(Atom.setIdleTTL(0)),
)

const commitHint =
  "\nIf you don't want to see those errors or don't need git, you can disable the \"Git auto commit\" feature on Settings > Version control."

const commitAll = (registry: AtomRegistry.AtomRegistry, message: string) =>
  void runGit(
    registry,
    Effect.flatMap(client, (git) => git.GitCommit({ message })),
  ).then(
    (done) => {
      if (done._tag === "NoIdentity") registry.set(gitDialog, { _tag: "Identity" })
    },
    (cause: unknown) => notify(registry, `${reasonOf(cause)}${commitHint}`),
  )

const revert = (registry: AtomRegistry.AtomRegistry, oid: string, path: string) =>
  void runGit(
    registry,
    Effect.flatMap(client, (git) => git.GitRevert({ oid, path })),
  ).catch((cause: unknown) => notify(registry, reasonOf(cause)))

const statusKind = (line: string) => line.trim()[0] ?? ""

const StatusLines = ({ status }: { readonly status: string }) => (
  <pre className="git-status">
    {status
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => (
        <span key={line} className="git-status-line" data-kind={statusKind(line)}>
          {line}
        </span>
      ))}
  </pre>
)

const dialogRef = (dialog: HTMLDialogElement | null) => {
  if (dialog !== null && !dialog.open) dialog.showModal()
}

const CommitDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const registry = useContext(RegistryContext)
  const status = useAtomValue(gitStatus)
  const [message, setMessage] = useState("")
  const commit = (from: HTMLElement) => {
    if (message.length < 1) return
    closeDialogOf(from)
    commitAll(registry, message)
  }
  const value = AsyncResult.isSuccess(status) ? status.value : null
  const body: ReactNode =
    value === null ? (
      <div>Loading...</div>
    ) : value.trim() === "" ? (
      <>
        <h3 className="git-heading">No changes to commit!</h3>
        <div className="confirm-actions">
          <button
            type="button"
            className="button-primary"
            onClick={(event) => closeDialogOf(event.currentTarget)}
          >
            Close
          </button>
        </div>
      </>
    ) : (
      <>
        <h2 className="git-title">You have uncommitted changes: </h2>
        <StatusLines status={value} />
        <h3 className="git-heading">Your commit message:</h3>
        <input
          {...logseq("seqno-git-commit-message")}
          type="text"
          aria-label="Your commit message:"
          autoFocus
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault()
              commit(event.currentTarget)
            }
          }}
        />
        <div className="confirm-actions">
          <button
            type="button"
            className="button-primary"
            onClick={(event) => commit(event.currentTarget)}
          >
            Commit
          </button>
        </div>
      </>
    )
  return (
    <Dialog
      id="seqno-git-commit"
      label="Commit"
      className="git-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="confirm-body">{body}</div>
    </Dialog>
  )
}

const IdentityDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const registry = useContext(RegistryContext)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const nameLabel = useId()
  const emailLabel = useId()
  const submit = (from: HTMLElement) => {
    if (name.trim() === "" || email.trim() === "") return
    closeDialogOf(from)
    void runGit(
      registry,
      Effect.flatMap(client, (git) => git.GitSetIdentity({ name, email })),
    ).then(
      () => notify(registry, "git config successfully!"),
      (cause: unknown) => notify(registry, reasonOf(cause)),
    )
  }
  return (
    <Dialog
      id="seqno-git-identity"
      label="Git username and email"
      className="git-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="confirm-body">
        <p className="git-lead">
          Git requires to setup your username and email address to commit, both of them will be
          stored locally.
        </p>
        <h3 id={nameLabel} className="git-heading">
          Your username:
        </h3>
        <input
          {...logseq("seqno-git-input")}
          type="text"
          aria-labelledby={nameLabel}
          autoFocus
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <h3 id={emailLabel} className="git-heading">
          Your email address:
        </h3>
        <input
          {...logseq("seqno-git-input")}
          type="text"
          aria-labelledby={emailLabel}
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        <div className="confirm-actions">
          <button
            type="button"
            className="button-primary"
            onClick={(event) => submit(event.currentTarget)}
          >
            Submit
          </button>
        </div>
      </div>
    </Dialog>
  )
}

const quoted = /"[^"]+"/g

export const splitArgs = (text: string): ReadonlyArray<string> => {
  const quotes = text.match(quoted) ?? []
  const rest = text.split(quoted)
  return rest.flatMap((part, at) => [
    ...part.split(/\s/).filter((word) => word.trim() !== ""),
    ...(at < quotes.length ? [(quotes[at] ?? "").slice(1, -1).trim()] : []),
  ])
}

const denied = new Set(["rm", "mv", "rename", "dd", ">", "command", "sudo"])

const runCommand = (registry: AtomRegistry.AtomRegistry, input: string) => {
  const trimmed = input.trim()
  const space = trimmed.indexOf(" ")
  const command = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase()
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim()
  if (command === "") return Promise.resolve()
  if (denied.has(command)) return Promise.resolve(notify(registry, `${command} is too dangerous!`))
  if (command !== "git") {
    return Promise.resolve(notify(registry, `seqno runs only git commands, not ${command}`))
  }
  const args = splitArgs(rest)
  return runGit(
    registry,
    Effect.gen(function* () {
      const git = yield* client
      if (args[0] === "commit") yield* git.GitRun({ args: ["add", "--ignore-errors", "./*"] })
      return yield* git.GitRun({ args })
    }),
  ).then(
    (result) =>
      notify(
        registry,
        result.exitCode !== 0
          ? `${args[0] ?? ""} error: ${result.stderr || result.stdout}`
          : result.stdout.trim() === ""
            ? `git ${rest} was executed successfully!`
            : result.stdout,
      ),
    (cause: unknown) => notify(registry, reasonOf(cause)),
  )
}

const RunDialog = ({ onClose }: { readonly onClose: () => void }) => {
  const registry = useContext(RegistryContext)
  const [command, setCommand] = useState("")
  const [running, setRunning] = useState(false)
  const title = useId()
  const run = () => {
    setRunning(true)
    void runCommand(registry, command).finally(() => setRunning(false))
  }
  return (
    <Dialog
      id="seqno-git-run"
      label="Run git command"
      className="git-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="confirm-body">
        <h1 id={title} className="git-title">
          Input command
        </h1>
        <input
          {...logseq("seqno-git-run-command")}
          type="text"
          aria-labelledby={title}
          autoFocus
          placeholder="git commit -m ..."
          value={command}
          onChange={(event) => setCommand(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault()
              run()
            }
          }}
        />
        <div className="git-run-row">
          <button type="button" className="button-primary" onClick={run}>
            Run
          </button>
          {running ? <span className="git-running">Running...</span> : null}
        </div>
      </div>
    </Dialog>
  )
}

const VersionText = ({ spec }: { readonly spec: string }) => (
  <pre className="git-version-text">
    {AsyncResult.getOrElse(useAtomValue(versionText(spec)), () => "")}
  </pre>
)

const HistoryDialog = ({
  page,
  onClose,
}: {
  readonly page: string
  readonly onClose: () => void
}) => {
  const registry = useContext(RegistryContext)
  const history = useAtomValue(pageHistory(page))
  const [hash, setHash] = useState("HEAD")
  const found = AsyncResult.getOrElse(history, () => ({ path: null, versions: [] }))
  const path = found.path ?? page
  return (
    <Dialog
      id="seqno-git-history"
      label="View page history"
      className="git-dialog git-history"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="git-history-body">
        <div className="git-history-list">
          <div className="git-history-heading">File history - {path}</div>
          {found.versions.map((version) => {
            const short = version.oid.slice(0, 7)
            return (
              <div key={version.oid} className="git-history-version">
                <hr />
                <div className="git-history-commit">
                  <a
                    href={`#${short}`}
                    className="git-history-hash"
                    aria-current={hash === short ? "true" : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      setHash(short)
                    }}
                  >
                    {short}
                  </a>
                  {version.subject}
                </div>
                <div className="git-history-date">{version.date}</div>
              </div>
            )
          })}
        </div>
        <div className="git-history-content">
          <div className="git-history-heading">{`${path} (${hash})`}</div>
          {found.path === null ? null : (
            <>
              <VersionText spec={`${hash}:${found.path}`} />
              <button
                type="button"
                className="button-primary"
                onClick={() => revert(registry, hash, path)}
              >
                Revert
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  )
}

export const GitDialogs = () => {
  useAtomMount(gitNotices)
  useAtomMount(commitOnClose)
  const [open, setOpen] = useAtom(gitDialog)
  const close = () => setOpen(null)
  if (open === null) return null
  switch (open._tag) {
    case "Commit":
      return <CommitDialog key="commit" onClose={close} />
    case "Identity":
      return <IdentityDialog key="identity" onClose={close} />
    case "Run":
      return <RunDialog key="run" onClose={close} />
    case "History":
      return <HistoryDialog key={`history ${open.page}`} page={open.page} onClose={close} />
  }
}

export const saveGitSettings = (registry: AtomRegistry.AtomRegistry, settings: GitSettings) =>
  void runGit(
    registry,
    Effect.flatMap(client, (git) => git.SetGitSettings(settings)),
  ).catch((cause: unknown) => notify(registry, reasonOf(cause)))

const Row = ({
  label,
  labelId,
  children,
}: {
  readonly label: string
  readonly labelId: string
  readonly children: ReactNode
}) => (
  <div className="settings-row">
    <span id={labelId} className="settings-label">
      {label}
    </span>
    <div className="settings-control">{children}</div>
  </div>
)

const Seconds = ({ settings }: { readonly settings: GitSettings }) => {
  const registry = useContext(RegistryContext)
  const label = useId()
  return (
    <Row label="Git auto commit seconds" labelId={label}>
      <input
        {...logseq("seqno-git-seconds")}
        key={settings.seconds}
        type="text"
        inputMode="numeric"
        aria-labelledby={label}
        defaultValue={settings.seconds}
        onBlur={(event) => {
          const input = event.currentTarget
          const value = /^\d+$/.test(input.value.trim()) ? Number(input.value.trim()) : Number.NaN
          if (value > 0 && value <= 86400)
            saveGitSettings(registry, { ...settings, seconds: value })
          else {
            notify(registry, "Invalid value! Must be a number between 1 and 86400")
            input.value = String(settings.seconds)
          }
        }}
      />
    </Row>
  )
}

export const VersionControl = () => {
  const registry = useContext(RegistryContext)
  const autoLabel = useId()
  const closeLabel = useId()
  const settings = AsyncResult.value(useAtomValue(gitSettings))
  if (settings._tag === "None") return null
  const current = settings.value
  return (
    <div className="git-settings">
      <div {...logseq("seqno-git-tip")}>
        <p>
          If you have Logseq Sync enabled, you can view a page&apos;s edit history directly. This
          section is for tech-savvy only.
        </p>
      </div>
      <p className="git-desc">
        To view page&apos;s edit history, click the three horizontal dots in the top-right corner
        and select &quot;View page history&quot;.
      </p>
      <p className="git-desc">
        For professional users, Logseq also supports using{" "}
        <a href="https://git-scm.com/" target="_blank" rel="noreferrer">
          Git
        </a>{" "}
        for version control. Use Git at your own risk as general Git issues are not supported by the
        Logseq team.
      </p>
      <Row label="Enable Git auto commit" labelId={autoLabel}>
        <SwitchButton
          on={current.autoCommit}
          labelledBy={autoLabel}
          onToggle={() =>
            saveGitSettings(registry, { ...current, autoCommit: !current.autoCommit })
          }
        />
      </Row>
      <Row label="Git commit on window close" labelId={closeLabel}>
        <SwitchButton
          on={current.commitOnClose}
          labelledBy={closeLabel}
          onToggle={() =>
            saveGitSettings(registry, { ...current, commitOnClose: !current.commitOnClose })
          }
        />
      </Row>
      <Seconds settings={current} />
    </div>
  )
}
