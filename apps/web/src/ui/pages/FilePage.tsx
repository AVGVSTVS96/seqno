import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { Predicate, Result, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { AtomRegistry } from "effect/reactivity"
import { useContext, useId } from "react"
import { logseq } from "@seqno/dom"
import { CodeFile } from "@seqno/outliner"
import { AppFilePath } from "@seqno/rpc"
import { readEdn } from "@seqno/syntax"
import { appFilesWatch, appFileText, writeAppFile } from "../../atoms.ts"
import { notify } from "../shell/Notices.tsx"
import { PagesStyle } from "./PagesStyle.tsx"

const isAppFile = Schema.is(AppFilePath)

const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase()

const configProblem = (text: string): string | null => {
  if (text.trim() === "") {
    return null
  }

  const read = readEdn(text)

  if (Result.isFailure(read)) {
    return "Failed to read file logseq/config.edn. Make sure your config is wrapped in {}. Also make sure that the characters '( { [' have their corresponding closing character ') } ]'."
  }

  return Predicate.isTagged(read.success, "Map") ? null : "The file logseq/config.edn is not valid."
}

const save = (
  registry: AtomRegistry.AtomRegistry,
  path: AppFilePath,
  before: string,
  after: string,
) => {
  if (after.trim() === before.trim()) {
    return
  }

  const problem = path === "logseq/config.edn" ? configProblem(after) : null

  if (problem !== null) {
    notify(registry, problem)

    return
  }

  registry.set(writeAppFile, { path, text: `${after.trim()}\n` })
}

const Editor = ({ path }: { readonly path: AppFilePath }) => {
  const registry = useContext(RegistryContext)
  const loaded = AsyncResult.isSuccess(useAtomValue(appFilesWatch))
  const text = useAtomValue(appFileText(path)) ?? ""

  return loaded ? (
    <CodeFile
      key={text}
      code={text.trim()}
      language={extensionOf(path)}
      onSave={(next) => {
        save(registry, path, text, next)
      }}
    />
  ) : null
}

export const FilePage = ({ path }: { readonly path: string }) => {
  const id = useId().replaceAll(/[^a-z0-9]/giu, "")

  return (
    <div {...logseq("seqno-file", id)}>
      <PagesStyle />
      <h1 {...logseq("seqno-file-title")}>
        <bdi>{path}</bdi>
      </h1>
      {isAppFile(path) ? (
        <Editor path={path} />
      ) : (
        <div>Format .{extensionOf(path)} is not supported.</div>
      )}
    </div>
  )
}
