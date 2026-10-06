#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, FileSystem, Match, Path } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { edgeCases } from "./cases.ts"
import { readGraph, writeGraph } from "./files.ts"
import { download, downloadSources } from "./downloads.ts"
import { defaultGeneratorOptions, generateGraph, graphDigest, graphStats, toLogseqFiles } from "./generator/index.ts"

const generatorFlags = {
  seed: Flag.Int("seed").pipe(Flag.withDefault(defaultGeneratorOptions.seed)),
  blocks: Flag.Int("blocks").pipe(Flag.withDefault(defaultGeneratorOptions.blocks)),
  pages: Flag.Int("pages").pipe(Flag.withDefault(defaultGeneratorOptions.pages)),
  journals: Flag.Int("journals").pipe(Flag.withDefault(defaultGeneratorOptions.journals)),
}

const generate = Command.make(
  "generate",
  { ...generatorFlags, out: Flag.Directory("out"), json: Flag.Boolean("json").pipe(Flag.withDefault(false)) },
  Effect.fn(function* ({ out, json, ...options }) {
    const graph = generateGraph(options)
    const files = json ? [{ path: "graph.json", content: JSON.stringify(graph) }] : toLogseqFiles(graph)
    yield* writeGraph(out, files)
    yield* Console.log(JSON.stringify({ out, files: files.length, digest: graphDigest(graph) }))
  }),
).pipe(Command.withDescription("Write the seeded graph as a Logseq OG folder (or graph.json with --json)"))

const stats = Command.make(
  "stats",
  generatorFlags,
  Effect.fn(function* (options) {
    const started = performance.now()
    const graph = generateGraph(options)
    const generateMs = Math.round(performance.now() - started)
    yield* Console.log(JSON.stringify({ seed: options.seed, digest: graphDigest(graph), generateMs, ...graphStats(graph) }, null, 2))
  }),
).pipe(Command.withDescription("Print the digest and shape of the seeded graph"))

const edgeCase = Command.make(
  "edge-case",
  { name: Argument.Literals("name", edgeCases.map((c) => c.name)), out: Flag.Directory("out") },
  Effect.fn(function* ({ name, out }) {
    const found = edgeCases.find((c) => c.name === name)
    if (found === undefined) return
    const files = yield* Match.valueTags(found.source, {
      Committed: ({ dir }) => readGraph(dir),
      Generated: ({ files }) => Effect.succeed(files()),
    })
    yield* writeGraph(out, files)
    yield* Console.log(JSON.stringify({ name, out, files: files.length }))
  }),
).pipe(Command.withDescription("Write one edge-case graph (committed or generated) to a folder"))

const fetchSources = Command.make(
  "download",
  {},
  Effect.fn(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    for (const source of downloadSources) {
      const dir = yield* download(source)
      const pages = yield* fs.readDirectory(path.join(dir, "pages"))
      yield* Console.log(JSON.stringify({ name: source.name, dir, commit: source.commit, license: source.license, pages: pages.length }))
    }
  }),
).pipe(Command.withDescription("Shallow-fetch real Logseq graphs into fixtures/downloads (gitignored)"))

const cli = Command.make("seqno-fixtures").pipe(Command.withSubcommands([generate, stats, edgeCase, fetchSources]))

Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
