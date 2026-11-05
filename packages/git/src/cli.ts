import * as git from "isomorphic-git"
import { dateStyleOf, medium, pretty, quotePath, short } from "./format.ts"
import type { CommitInfo, DateStyle } from "./format.ts"
import type { Repo } from "./repo.ts"

export interface Result {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

const ok = (stdout = ""): Result => ({ stdout, stderr: "", exitCode: 0 })
const fail = (stderr: string, exitCode = 128, stdout = ""): Result => ({ stdout, stderr, exitCode })
const fatal = (message: string) => fail(`fatal: ${message}\n`)

const unsupported = (command: string) =>
  fatal(`seqno runs git in the browser and can't run 'git ${command}'`)

const identityUnknown = `Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

to set your account's default identity.
Omit --global to set the identity only in this repository.

fatal: unable to auto-detect email address (got 'seqno@browser.(none)')
`

const noPushDestination = `fatal: No configured push destination.
Either specify the URL from the command-line or configure a remote repository using

    git remote add <name> <url>

and then push using the remote name

    git push <name>

To push to multiple remotes at once, configure a remote group using

    git config remotes.<groupname> "<remote1> <remote2>"

and then push using the group name

    git push <groupname>

`

const noTracking = (branch: string) => `There is no tracking information for the current branch.
Please specify which branch you want to merge with.
See git-pull(1) for details.

    git pull <remote> <branch>

If you wish to set tracking information for this branch you can do so with:

    git branch --set-upstream-to=<remote>/<branch> ${branch}

`

const noRemote = (name: string) =>
  fail(`fatal: '${name}' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
`)

const indexLocked = fail(`fatal: Unable to create '.git/index.lock': File exists.

Another git process seems to be running in this repository, e.g.
an editor opened by 'git commit'. Please make sure all processes
are terminated then try again. If it still fails, a git process
may have crashed in this repository earlier:
remove the file manually to continue.
`)

const upstream = /@\{(u|upstream|push)\}$/i

class Fatal extends Error {
  readonly result: Result
  constructor(result: Result) {
    super(result.stderr)
    this.result = result
  }
}

const split = (args: readonly string[]) => {
  const at = args.indexOf("--")

  return at === -1
    ? { options: args, paths: [] }
    : { options: args.slice(0, at), paths: args.slice(at + 1) }
}

const label = (code: string) =>
  code === "A" ? "new file:   " : code === "D" ? "deleted:    " : "modified:   "

const logOptions = (args: readonly string[]) => {
  let depth: number | undefined

  let format: {
    readonly kind: "medium" | "oneline" | "format" | "tformat"
    readonly template: string
  } = {
    kind: "medium",
    template: "",
  }

  let date: DateStyle = "default"
  let patch = false
  let nameOnly = false
  const revs: string[] = []
  const { options, paths } = split(args)
  const named = [...paths]

  for (let at = 0; at < options.length; at += 1) {
    const arg = options[at] ?? ""

    if (/^-\d+$/.test(arg)) {
      depth = Number(arg.slice(1))
    } else if (arg === "-n" || arg === "--max-count") {
      depth = Number(options[(at += 1)])
    } else if (arg.startsWith("--max-count=")) {
      depth = Number(arg.slice("--max-count=".length))
    } else if (/^-n\d+$/.test(arg)) {
      depth = Number(arg.slice(2))
    } else if (arg === "--oneline") {
      format = { kind: "oneline", template: "" }
    } else if (arg.startsWith("--pretty=") || arg.startsWith("--format=")) {
      const value = arg.slice(arg.indexOf("=") + 1)
      format = value.startsWith("format:")
        ? { kind: "format", template: value.slice("format:".length) }
        : value.startsWith("tformat:")
          ? { kind: "tformat", template: value.slice("tformat:".length) }
          : value === "oneline"
            ? { kind: "oneline", template: "" }
            : value === "medium"
              ? { kind: "medium", template: "" }
              : { kind: arg.startsWith("--format=") ? "tformat" : "format", template: value }
    } else if (arg.startsWith("--date=")) {
      date = dateStyleOf(arg.slice("--date=".length))
    } else if (arg === "-p" || arg === "--patch" || arg === "-u") {
      patch = true
    } else if (arg === "--name-only") {
      nameOnly = true
    } else if (
      ["--follow", "--no-color", "--color=never", "--no-decorate", "--decorate=no"].includes(arg)
    ) {
      continue
    } else if (arg.startsWith("-")) {
      throw new Fatal(unsupported(`log ${arg}`))
    } else {
      revs.push(arg)
    }
  }

  return { depth, format, date, patch, nameOnly, revs, named }
}

export const makeCli = (repo: Repo, graphPath: string, now: () => Date = () => new Date()) => {
  const resolve = async (rev: string): Promise<string> => {
    if (upstream.test(rev)) {
      throw new Fatal(fatal(`no upstream configured for branch '${await repo.branch()}'`))
    }

    const match = /^(.*?)((?:[~^]\d*)*)$/.exec(rev)
    const base = match?.[1] ?? rev
    const steps = match?.[2] ?? ""

    const found =
      (await git
        .resolveRef({ fs: repo.fs, gitdir: "/.git", ref: base === "" ? "HEAD" : base })
        .catch(() => null)) ??
      (/^[0-9a-f]{4,40}$/.test(base)
        ? await git
            .expandOid({ fs: repo.fs, gitdir: "/.git", oid: base, cache: repo.cache })
            .catch(() => null)
        : null)

    if (found === null) {
      throw new Fatal(
        fatal(`ambiguous argument '${rev}': unknown revision or path not in the working tree.`),
      )
    }

    let oid: string = found

    for (const step of steps.match(/[~^]\d*/g) ?? []) {
      const count = step.length === 1 ? 1 : Number(step.slice(1))

      for (let n = 0; n < (step.startsWith("~") ? count : 1); n += 1) {
        const parent: string | undefined = (await repo.readCommit(oid)).parent[
          step.startsWith("^") ? count - 1 : 0
        ]

        if (parent === undefined) {
          throw new Fatal(
            fatal(`ambiguous argument '${rev}': unknown revision or path not in the working tree.`),
          )
        }

        oid = parent
      }
    }

    return oid
  }

  const tree = async (rev: string) => ({
    _tag: "Tree" as const,
    ref: await resolve(rev || "HEAD"),
  })

  const needCommits = async () => {
    if ((await repo.head()) === null) {
      throw new Fatal(
        fatal(`your current branch '${await repo.branch()}' does not have any commits yet`),
      )
    }
  }

  const reachable = async (oid: string) =>
    new Set((await repo.commits(oid)).map((entry) => entry.oid))

  const status = async (options: readonly string[], overrides: ReadonlyMap<string, string>) => {
    const brief = options.some(
      (option) => option.startsWith("--porcelain") || option === "-s" || option === "--short",
    )

    const lines = await repo.porcelain(overrides)

    if (brief) {
      return ok(lines)
    }

    const entries = lines.split("\n").filter((line) => line.length > 0)
    const toCommit = entries.filter((line) => line[0] !== " " && line[0] !== "?")
    const notStaged = entries.filter((line) => line[1] !== " " && line[0] !== "?")
    const untracked = entries.filter((line) => line.startsWith("??"))
    const out = [`On branch ${await repo.branch()}`]

    if ((await repo.head()) === null) {
      out.push("", "No commits yet")
    }

    if (toCommit.length > 0) {
      out.push(
        "",
        "Changes to be committed:",
        ...toCommit.map((line) => `\t${label(line[0] ?? "")}${line.slice(3)}`),
      )
    }

    if (notStaged.length > 0) {
      out.push(
        "",
        "Changes not staged for commit:",
        ...notStaged.map((line) => `\t${label(line[1] ?? "")}${line.slice(3)}`),
      )
    }

    if (untracked.length > 0) {
      out.push("", "Untracked files:", ...untracked.map((line) => `\t${line.slice(3)}`))
    }

    out.push(
      "",
      toCommit.length > 0
        ? ""
        : notStaged.length > 0
          ? 'no changes added to commit (use "git add" and/or "git commit -a")'
          : untracked.length > 0
            ? 'nothing added to commit but untracked files present (use "git add" to track)'
            : "nothing to commit, working tree clean",
    )

    return ok(`${out.join("\n").trimEnd()}\n`)
  }

  const add = async (args: readonly string[]) => {
    const { options, paths } = split(args)
    const named = [...options.filter((arg) => !arg.startsWith("-")), ...paths]
    const all = options.some((option) => option === "-A" || option === "--all")

    if (
      all ||
      named.some((path) => path === "." || path === "./*" || path === "*" || path === "./")
    ) {
      await repo.stageAll()

      return ok()
    }

    if (options.some((option) => option === "-u" || option === "--update")) {
      await repo.stage(
        (await repo.matrix()).filter(([, head, , stage]) => head !== 0 || stage !== 0),
      )

      return ok()
    }

    if (named.length === 0) {
      return ok("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\n")
    }

    for (const path of named) {
      const rows = await repo.matrix([path.replace(/^\.\//, "")])

      if (rows.length === 0) {
        return fatal(`pathspec '${path}' did not match any files`)
      }

      await repo.stage(rows)
    }

    return ok()
  }

  const stats = async (oid: string) => {
    const commit = await repo.readCommit(oid)
    const parent = commit.parent[0]

    const list = await repo.changes(
      parent === undefined ? { _tag: "Empty" } : { _tag: "Tree", ref: parent },
      { _tag: "Tree", ref: oid },
      [],
    )

    const text = await repo.patches(list, new Map())
    const lines = text.split("\n")

    const insertions = lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++ "),
    ).length

    const deletions = lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("--- "),
    ).length

    const parts = [`${list.length} file${list.length === 1 ? "" : "s"} changed`]

    if (insertions > 0 || deletions === 0) {
      parts.push(`${insertions} insertion${insertions === 1 ? "" : "s"}(+)`)
    }

    if (deletions > 0) {
      parts.push(`${deletions} deletion${deletions === 1 ? "" : "s"}(-)`)
    }

    const modes = list.flatMap((change) =>
      change.before === null
        ? [` create mode 100644 ${change.path}`]
        : change.after === null
          ? [` delete mode 100644 ${change.path}`]
          : [],
    )

    return [` ${parts.join(", ")}`, ...modes].join("\n")
  }

  const commit = async (args: readonly string[]) => {
    const messages: string[] = []
    let all = false
    let allowEmpty = false

    for (let at = 0; at < args.length; at += 1) {
      const arg = args[at] ?? ""

      if (arg === "-m" || arg === "--message") {
        messages.push(args[(at += 1)] ?? "")
      } else if (arg.startsWith("--message=")) {
        messages.push(arg.slice("--message=".length))
      } else if (arg === "-am") {
        all = true
        messages.push(args[(at += 1)] ?? "")
      } else if (arg.startsWith("-m") && arg.length > 2) {
        messages.push(arg.slice(2))
      } else if (arg === "-a" || arg === "--all") {
        all = true
      } else if (arg === "--allow-empty") {
        allowEmpty = true
      } else if (
        ["-q", "--quiet", "--no-verify", "-n", "--no-gpg-sign", "--no-edit"].includes(arg)
      ) {
        continue
      } else {
        return unsupported(`commit ${arg}`)
      }
    }

    if (messages.length === 0) {
      return fatal("seqno can't open an editor for the commit message; pass it with -m")
    }

    if (all) {
      await repo.stage(
        (await repo.matrix()).filter(([, head, , stage]) => head !== 0 || stage !== 0),
      )
    }

    const rooted = (await repo.head()) === null
    const done = await repo.commit(messages.join("\n\n"), { allowEmpty })

    switch (done._tag) {
      case "NoIdentity": {
        return fail(identityUnknown)
      }

      case "Busy": {
        return indexLocked
      }

      case "NothingToCommit": {
        const lines = await repo.porcelain()
        const untracked = lines.includes("?? ")

        const unstaged = lines
          .split("\n")
          .some((line) => line.length > 1 && line[1] !== " " && line[0] !== "?")

        return fail(
          "",
          1,
          `On branch ${await repo.branch()}\n${
            unstaged
              ? 'no changes added to commit (use "git add" and/or "git commit -a")'
              : untracked
                ? 'nothing added to commit but untracked files present (use "git add" to track)'
                : "nothing to commit, working tree clean"
          }\n`,
        )
      }

      case "Committed": {
        const subject = messages[0]?.split("\n")[0] ?? ""

        return ok(
          `[${await repo.branch()}${rooted ? " (root-commit)" : ""} ${short(done.oid)}] ${subject}\n${await stats(done.oid)}\n`,
        )
      }
    }
  }

  const commitPatch = async (
    entry: CommitInfo,
    paths: readonly string[],
    overrides: ReadonlyMap<string, string>,
  ) => {
    const parent = entry.parent[0]

    const list = await repo.changes(
      parent === undefined ? { _tag: "Empty" } : { _tag: "Tree", ref: parent },
      { _tag: "Tree", ref: entry.oid },
      paths,
    )

    return { list, text: await repo.patches(list, overrides) }
  }

  const log = async (args: readonly string[], overrides: ReadonlyMap<string, string>) => {
    const { depth, format, date, patch, nameOnly, revs, named } = logOptions(args)
    const paths = [...named]
    const refs: string[] = []

    for (const rev of revs) {
      if (
        rev.includes("..") ||
        upstream.test(rev) ||
        (await resolve(rev).then(
          () => true,
          () => false,
        ))
      ) {
        refs.push(rev)
      } else {
        paths.push(rev)
      }
    }

    if (refs.length === 0) {
      await needCommits()
    }

    const range = refs[0]?.split("..")

    const tip =
      range === undefined ? "HEAD" : range.length === 2 ? range[1] || "HEAD" : (range[0] ?? "HEAD")

    const tipOid = await resolve(tip)

    const excluded =
      range?.length === 2 ? await reachable(await resolve(range[0] || "HEAD")) : new Set<string>()

    const found = (
      await repo.commits(
        tipOid,
        paths.length === 1 && paths[0] !== undefined
          ? { filepath: paths[0].replace(/^\.\//, "") }
          : {},
      )
    ).filter((entry) => !excluded.has(entry.oid))

    const picked = depth === undefined ? found : found.slice(0, depth)
    const blocks: string[] = []

    for (const entry of picked) {
      const head =
        format.kind === "medium"
          ? medium(entry, date, now())
          : format.kind === "oneline"
            ? `${short(entry.oid)} ${entry.message.trimEnd().split("\n")[0] ?? ""}`
            : pretty(format.template, entry, date, now())

      if (!patch && !nameOnly) {
        blocks.push(head)
        continue
      }

      const { list, text } = await commitPatch(entry, paths, overrides)
      const quoteNonAscii = await repo.quoting(overrides)

      const body = nameOnly
        ? list
            .map((change) => `${quotePath(change.path, { quoteNonAscii, quoteSpace: false })}\n`)
            .join("")
        : text

      blocks.push(format.kind === "medium" ? `${head}\n\n${body}` : `${head}\n${body}`)
    }

    const separator = format.kind === "medium" && !patch && !nameOnly ? "\n\n" : "\n"
    const out = blocks.join(separator)

    return ok(
      format.kind === "format" ? out : out === "" ? "" : `${out}${out.endsWith("\n") ? "" : "\n"}`,
    )
  }

  const show = async (args: readonly string[], overrides: ReadonlyMap<string, string>) => {
    const { options, paths } = split(args)
    const target = options.find((arg) => !arg.startsWith("-")) ?? "HEAD"
    const colon = target.indexOf(":")

    if (colon !== -1) {
      const rev = target.slice(0, colon) || "HEAD"
      const path = target.slice(colon + 1).replace(/^\.\//, "")
      const oid = await resolve(rev)
      const blob = await repo.readBlob(oid, path)

      if (blob === null) {
        return fatal(`path '${path}' does not exist in '${rev}'`)
      }

      return ok(new TextDecoder().decode(blob.bytes))
    }

    await needCommits()
    const entry = await repo.readCommit(await resolve(target))
    const { text } = await commitPatch(entry, paths, overrides)

    return ok(`${medium(entry, "default", now())}\n${text === "" ? "" : `\n${text}`}`)
  }

  const diff = async (args: readonly string[], overrides: ReadonlyMap<string, string>) => {
    const { options, paths } = split(args)
    const cached = options.some((option) => option === "--cached" || option === "--staged")
    const nameOnly = options.includes("--name-only")
    const quiet = options.includes("--quiet") || options.includes("--exit-code")
    const revs = options.filter((option) => !option.startsWith("-"))

    const unknown = options.find(
      (option) =>
        option.startsWith("-") &&
        ![
          "--cached",
          "--staged",
          "--name-only",
          "--quiet",
          "--exit-code",
          "--no-color",
          "-p",
          "--patch",
        ].includes(option),
    )

    if (unknown !== undefined) {
      return unsupported(`diff ${unknown}`)
    }

    const pair = revs.length === 1 && revs[0]?.includes("..") ? revs[0].split("..") : revs
    const empty = { _tag: "Empty" as const }
    const headTree = async () => ((await repo.head()) === null ? empty : await tree("HEAD"))

    const [from, to] =
      pair.length >= 2
        ? [await tree(pair[0] ?? ""), await tree(pair[1] ?? "")]
        : pair.length === 1
          ? [
              await tree(pair[0] ?? ""),
              cached ? { _tag: "Stage" as const } : { _tag: "Workdir" as const },
            ]
          : cached
            ? [await headTree(), { _tag: "Stage" as const }]
            : [{ _tag: "Stage" as const }, { _tag: "Workdir" as const }]

    const list = await repo.changes(from, to, paths)
    const code = quiet && list.length > 0 ? 1 : 0

    if (quiet) {
      return { stdout: "", stderr: "", exitCode: code }
    }

    const quoteNonAscii = await repo.quoting(overrides)

    return ok(
      nameOnly
        ? list
            .map((change) => `${quotePath(change.path, { quoteNonAscii, quoteSpace: false })}\n`)
            .join("")
        : await repo.patches(list, overrides),
    )
  }

  const revParse = async (args: readonly string[]) => {
    const quiet = args.includes("-q") || args.includes("--quiet")
    const verify = args.includes("--verify")
    const out: string[] = []
    let abbrev = false

    for (const arg of args) {
      if (arg === "-q" || arg === "--quiet" || arg === "--verify") {
        continue
      }

      if (arg === "--abbrev-ref") {
        abbrev = true
      } else if (arg === "--show-toplevel") {
        out.push(graphPath)
      } else if (arg === "--is-inside-work-tree") {
        out.push("true")
      } else if (arg === "--git-dir") {
        out.push(".git")
      } else if (arg === "--short") {
        continue
      } else if (arg.startsWith("-")) {
        return unsupported(`rev-parse ${arg}`)
      } else if (abbrev && arg === "HEAD") {
        out.push(await repo.branch())
      } else {
        const oid = await resolve(arg).catch((error: unknown) =>
          verify && quiet && !(error instanceof Fatal && error.result.stderr.includes("upstream"))
            ? null
            : Promise.reject(error),
        )

        if (oid === null) {
          return fail("", 1)
        }

        out.push(args.includes("--short") ? short(oid) : oid)
      }
    }

    return ok(out.map((line) => `${line}\n`).join(""))
  }

  const revList = async (args: readonly string[]) => {
    const count = args.includes("--count")
    const revs = args.filter((arg) => !arg.startsWith("-"))
    const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--count")

    if (unknown !== undefined) {
      return unsupported(`rev-list ${unknown}`)
    }

    const included = new Set<string>()
    const excluded = new Set<string>()

    for (const rev of revs) {
      const [left, right] = rev.split("..")

      if (right !== undefined) {
        for (const oid of await reachable(await resolve(left || "HEAD"))) {
          excluded.add(oid)
        }

        for (const oid of await reachable(await resolve(right || "HEAD"))) {
          included.add(oid)
        }
      } else if (rev.startsWith("^")) {
        for (const oid of await reachable(await resolve(rev.slice(1)))) {
          excluded.add(oid)
        }
      } else {
        for (const oid of await reachable(await resolve(rev))) {
          included.add(oid)
        }
      }
    }

    const kept = [...included].filter((oid) => !excluded.has(oid))

    return ok(count ? `${kept.length}\n` : kept.map((oid) => `${oid}\n`).join(""))
  }

  const updateRef = async (args: readonly string[]) => {
    const named = args.filter((arg) => !arg.startsWith("-"))
    const [ref, value] = named

    if (ref === undefined) {
      return fatal("usage: git update-ref <refname> <new-val>")
    }

    if (args.includes("-d")) {
      await git.deleteRef({ fs: repo.fs, gitdir: "/.git", ref })

      return ok()
    }

    if (value === undefined) {
      return fatal("usage: git update-ref <refname> <new-val>")
    }

    await git.writeRef({
      fs: repo.fs,
      gitdir: "/.git",
      ref,
      value: await resolve(value),
      force: true,
    })

    return ok()
  }

  const config = async (args: readonly string[]) => {
    const global = args.includes("--global")
    const unset = args.includes("--unset")
    const named = args.filter((arg) => !arg.startsWith("-"))

    const unknown = args.find(
      (arg) => arg.startsWith("-") && !["--global", "--local", "--get", "--unset"].includes(arg),
    )

    if (unknown !== undefined) {
      return unsupported(`config ${unknown}`)
    }

    const [key, value] = named

    if (key === undefined) {
      return fatal("seqno's git config needs a key")
    }

    if (unset || value !== undefined) {
      if (global) {
        await repo.setGlobal(key, unset ? undefined : value)
      } else {
        await repo.setRepoConfig(key, unset ? undefined : value)
      }

      return ok()
    }

    const found = global ? undefined : await repo.repoConfig(key)
    const read = found ?? (await repo.config(key))

    return read === undefined ? fail("", 1) : ok(`${read}\n`)
  }

  const branch = async (args: readonly string[]) => {
    if (args.includes("--show-current")) {
      return ok(`${await repo.branch()}\n`)
    }

    if (args.length > 0 && !args.every((arg) => arg === "--list" || arg === "-l")) {
      return unsupported(`branch ${args.join(" ")}`)
    }

    if ((await repo.head()) === null) {
      return ok()
    }

    const names = await git.listBranches({ fs: repo.fs, gitdir: "/.git" })
    const current = await repo.branch()

    return ok(names.map((name) => `${name === current ? "*" : " "} ${name}\n`).join(""))
  }

  const lsFiles = async (args: readonly string[]) => {
    const unknown = args.find(
      (arg) =>
        arg.startsWith("-") &&
        arg !== "-u" &&
        arg !== "--unmerged" &&
        arg !== "--cached" &&
        arg !== "-c",
    )

    if (unknown !== undefined) {
      return unsupported(`ls-files ${unknown}`)
    }

    if (args.includes("-u") || args.includes("--unmerged")) {
      return ok()
    }

    const files = await git.listFiles({ fs: repo.fs, dir: "/", gitdir: "/.git", cache: repo.cache })

    return ok(files.map((file) => `${file}\n`).join(""))
  }

  const command = async (
    name: string,
    rest: readonly string[],
    overrides: ReadonlyMap<string, string>,
  ): Promise<Result> => {
    switch (name) {
      case "init": {
        return ok(
          (await repo.ensure())
            ? `Initialized empty Git repository in ${graphPath}/.git/\n`
            : `Reinitialized existing Git repository in ${graphPath}/.git/\n`,
        )
      }

      case "status": {
        return await status(rest, overrides)
      }

      case "add": {
        return await add(rest)
      }

      case "commit": {
        return await commit(rest)
      }

      case "log": {
        return await log(rest, overrides)
      }

      case "show": {
        return await show(rest, overrides)
      }

      case "diff": {
        return await diff(rest, overrides)
      }

      case "rev-parse": {
        return await revParse(rest)
      }

      case "rev-list": {
        return await revList(rest)
      }

      case "update-ref": {
        return await updateRef(rest)
      }

      case "config": {
        return await config(rest)
      }

      case "branch": {
        return await branch(rest)
      }

      case "ls-files": {
        return await lsFiles(rest)
      }

      case "remote": {
        return rest.every((arg) => arg === "-v" || arg === "--verbose")
          ? ok()
          : unsupported(`remote ${rest.join(" ")}`)
      }

      case "fetch": {
        const remote = rest.find((arg) => !arg.startsWith("-"))

        return remote === undefined ? ok() : noRemote(remote)
      }

      case "push": {
        const remote = rest.find((arg) => !arg.startsWith("-"))

        return remote === undefined ? fail(noPushDestination) : noRemote(remote)
      }

      case "pull": {
        const remote = rest.find((arg) => !arg.startsWith("-"))

        return remote === undefined ? fail(noTracking(await repo.branch()), 1) : noRemote(remote)
      }

      case "merge":
      case "rebase": {
        if (rest.includes("--abort")) {
          return name === "merge"
            ? fatal("There is no merge to abort (MERGE_HEAD missing).")
            : fatal("no rebase in progress")
        }

        const target = rest.find((arg) => !arg.startsWith("-"))

        if (target === undefined && name === "rebase") {
          return fatal(`no upstream configured for branch '${await repo.branch()}'`)
        }

        if (target !== undefined && upstream.test(target)) {
          return fatal(`no upstream configured for branch '${await repo.branch()}'`)
        }

        return unsupported(`${name} ${rest.join(" ")}`)
      }

      default: {
        return unsupported(name)
      }
    }
  }

  return async (args: readonly string[]): Promise<Result> => {
    const overrides = new Map<string, string>()
    let at = 0

    while (at < args.length) {
      const arg = args[at] ?? ""

      if (arg === "-C") {
        const path = args[at + 1] ?? ""

        if (path !== graphPath && path !== "." && path !== "") {
          return fatal(`cannot change to '${path}': No such file or directory`)
        }

        at += 2
      } else if (arg === "-c") {
        const [key = "", ...value] = (args[at + 1] ?? "").split("=")
        overrides.set(key.toLowerCase(), value.length === 0 ? "true" : value.join("="))
        at += 2
      } else if (
        arg === "--no-pager" ||
        arg === "--literal-pathspecs" ||
        arg === "--no-optional-locks"
      ) {
        at += 1
      } else {
        break
      }
    }

    const name = args[at]

    if (name === undefined) {
      return fail("usage: git [-C <path>] [-c <name>=<value>] <command> [<args>]\n", 1)
    }

    try {
      await repo.ensure()
      const rest = args.slice(at + 1)

      return name === "add" || name === "commit"
        ? await repo.locked(async () => await command(name, rest, overrides), indexLocked)
        : await command(name, rest, overrides)
    } catch (error) {
      if (error instanceof Fatal) {
        return error.result
      }

      return fatal(error instanceof Error ? error.message : String(error))
    }
  }
}

export type Cli = ReturnType<typeof makeCli>
