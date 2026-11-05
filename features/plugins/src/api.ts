import { Effect, Match, Option, Schema, Stream } from "effect"
import { normalizePageName, PageId } from "@seqno/domain"
import type { Block, BlockDraft, BlockId, Command, GraphEvent, Page, Props } from "@seqno/domain"
import { editingBlock } from "@seqno/editor"
import type { NavigationTarget } from "@seqno/outliner"
import { CoreClient } from "@seqno/rpc"
import type { GitResult, QueryResult } from "@seqno/rpc"
import { splitProperties } from "@seqno/syntax"
import { assetsApi } from "./assets.ts"
import type { AssetBridge } from "./assets.ts"
import type { Api, Host } from "./host.ts"
import { snakeCase } from "./protocol.ts"
import type { Handlers } from "./protocol.ts"
import { elementById, rectOf } from "./inject.ts"
import { cursorPosition } from "./selection.ts"
import type { LogseqDb } from "./datalog.ts"
import { resolveInput } from "./inputs.ts"
import type { InputContext } from "./inputs.ts"
import { amount, asFields, asList, list, record, scalarText, text, texts } from "./package.ts"
import type { Fields } from "./package.ts"
import {
  blockJson,
  contentOf,
  pageJson,
  properties,
  numberOf,
  treeJson,
  uuidOfNumber,
} from "./shapes.ts"
import type { Tree } from "./shapes.ts"
import { pluginCommands, slashCommands, uiItems } from "./state.ts"
import type { Keybinding, PluginCommand, ThemeMode } from "./state.ts"
import type { AtomRegistry } from "effect/reactivity"

export type Route =
  | { readonly _tag: "Journals" }
  | { readonly _tag: "Page"; readonly name: string }
  | { readonly _tag: "AllPages" }
  | { readonly _tag: "Graph" }
  | { readonly _tag: "Other"; readonly path: string }

export interface Bridge {
  readonly run: <A, E>(effect: Effect.Effect<A, E, CoreClient>) => Promise<A>
  readonly pagesChanged: () => void
  readonly graphName: () => string | null
  readonly route: () => Route
  readonly navigate: (target: NavigationTarget | Route) => void
  readonly notify: (message: string) => void
  readonly themeMode: () => ThemeMode
  readonly showBrackets: () => boolean
  readonly setSidebar: (side: "left" | "right", visible: boolean) => void
  readonly sidebarOpen: (side: "left" | "right") => boolean
  readonly editBlock: (blockId: BlockId, caret: number | null) => void
  readonly exitEditing: () => void
  readonly selectedBlocks: () => readonly BlockId[]
  readonly assets: AssetBridge
  readonly git: GitBridge
}

export interface GitBridge {
  readonly exec: (args: readonly string[]) => Promise<GitResult>
  readonly loadIgnore: () => Promise<string>
  readonly saveIgnore: (text: string) => Promise<void>
}

interface GraphDb {
  current: { readonly graph: string | null; readonly db: LogseqDb } | null
  stale: "all" | Set<PageId>
  watching: boolean
  queue: Promise<LogseqDb | null>
}

export const logseqVersion = "0.10.9"

export interface CursorRef {
  current: { readonly blockId: BlockId; readonly caret: number } | null
}

export const lastCursor: CursorRef = { current: null }

const decodePageId = Schema.decodeUnknownOption(PageId)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

const uuidIn = Match.type<unknown>().pipe(
  Match.when(Match.number, (id) => uuidOfNumber(id)),
  Match.when(Match.string, (uuid) => uuid),
  Match.when(Schema.is(Schema.Struct({ uuid: Schema.String })), ({ uuid }) => uuid),
  Match.when(Schema.is(Schema.Struct({ id: Schema.Number })), ({ id }) => uuidOfNumber(id)),
  Match.orElse(() => null),
)

const valueText = Match.type<unknown>().pipe(
  Match.when(Match.string, (value) => value),
  Match.when(
    (value: unknown): value is readonly unknown[] => Array.isArray(value),
    (items) => items.map((item) => scalarText(item) ?? String(item)).join(", "),
  ),
  Match.orElse((value) => scalarText(value) ?? String(value)),
)

const kebab = (key: string) => key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)

const minimalEdit = (before: string, after: string) => {
  let start = 0

  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }

  let end = 0

  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++
  }

  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

interface BatchBlock {
  readonly content: string
  readonly properties: Fields
  readonly children: readonly BatchBlock[]
}

const batchOf = (block: Fields): BatchBlock => ({
  content: text(block["content"]) ?? "",
  properties: record(block["properties"]),
  children: list(block["children"]).map((child) => batchOf(record(child))),
})

const draftOf = (content: string, extra: Fields): BlockDraft => {
  const { text: body, props } = splitProperties(content)
  const merged: Record<string, string> = Object.fromEntries(props)

  for (const [key, value] of Object.entries(extra)) {
    merged[kebab(key)] = valueText(value)
  }

  return { text: body, props: merged, children: [] }
}

const draftTree = (batch: BatchBlock): BlockDraft => {
  const { text: body, props } = draftOf(batch.content, batch.properties)

  return { text: body, props, children: batch.children.map(draftTree) }
}

const keybindingOf = (binding: Fields): Keybinding | null => {
  const bound = texts(binding["binding"])

  if (bound.length === 0) {
    return null
  }

  const mode = binding["mode"]

  return {
    binding: bound,
    mac: texts(binding["mac"]),
    mode: mode === "editing" || mode === "non-editing" ? mode : "global",
  }
}

const created = (events: readonly GraphEvent[]) =>
  events.flatMap((event) => (event._tag === "BlockUpserted" ? [event.block] : []))

const elementRect = (query: string | null) => {
  const element = query === null ? null : document.querySelector(query)

  return element === null ? null : rectOf(element)
}

const insertBlocks = (
  pageId: PageId,
  parentId: BlockId | null,
  after: BlockId | undefined,
  blocks: readonly [BlockDraft, ...BlockDraft[]],
): Command => {
  const command = { _tag: "InsertBlocks", pageId, parentId, blocks } as const

  return after === undefined ? command : { ...command, after }
}

const moveBlocks = (
  blockIds: readonly [BlockId, ...BlockId[]],
  parentId: BlockId | null,
  after: BlockId | undefined,
): Command => {
  const command = { _tag: "MoveBlocks", blockIds, parentId } as const

  return after === undefined ? command : { ...command, after }
}

export const routePayload = (route: Route) => {
  switch (route._tag) {
    case "Journals": {
      return { path: "/", template: "/", name: "home", parameters: { path: {}, query: {} } }
    }

    case "Page": {
      return {
        path: `/page/${encodeURIComponent(route.name)}`,
        template: "/page/:name",
        name: "page",
        parameters: { path: { name: route.name }, query: {} },
      }
    }

    case "AllPages": {
      return {
        path: "/all-pages",
        template: "/all-pages",
        name: "all-pages",
        parameters: { path: {}, query: {} },
      }
    }

    case "Graph": {
      return {
        path: "/graph",
        template: "/graph",
        name: "graph",
        parameters: { path: {}, query: {} },
      }
    }

    case "Other": {
      return {
        path: route.path,
        template: route.path,
        name: "other",
        parameters: { path: {}, query: {} },
      }
    }
  }
}

const unsupported = (method: string) => new Error(`seqno doesn't support logseq ${method} yet`)

export const createApi = (registry: AtomRegistry.AtomRegistry, bridge: Bridge) => {
  const core = async <A, E>(use: (client: CoreClient["Service"]) => Effect.Effect<A, E>) =>
    await bridge.run(Effect.flatMap(CoreClient, use))

  const pages = async () => await core((client) => client.GetPages())

  const pageByName = async (name: string) => {
    const wanted = normalizePageName(name)

    return (await pages()).find((page) => page.name === wanted) ?? null
  }

  const findPage = async (uuid: string | null): Promise<Page | null> => {
    if (uuid === null) {
      return null
    }

    const all = await pages()

    return (
      all.find((page) => page.id === uuid) ??
      all.find((page) => page.name === normalizePageName(uuid)) ??
      null
    )
  }

  const treeOf = async (pageId: PageId): Promise<Tree> =>
    await core((client) => client.GetPage({ pageId }))

  const findBlock = async (uuid: string | null): Promise<{ block: Block; tree: Tree } | null> => {
    if (uuid === null) {
      return null
    }

    const block = await core((client) => client.GetBlockByRef({ uuid })).catch(() => null)

    if (block === null) {
      return null
    }

    const tree = await treeOf(block.pageId)
    const fresh = tree.blocks.find((candidate) => candidate.id === block.id) ?? block

    return { block: fresh, tree }
  }

  const mustBlock = async (uuid: string | null) => {
    const found = await findBlock(uuid)

    if (found === null) {
      throw new Error(`No block ${String(uuid)}`)
    }

    return found
  }

  const dispatch = async (commands: readonly Command[]) => {
    const events = await core((client) => client.DispatchAll({ commands }))

    if (events.some((event) => event._tag === "PageUpserted" || event._tag === "PageDeleted")) {
      bridge.pagesChanged()
    }

    return events
  }

  const blockOut = async (block: Block | undefined, nested = false) => {
    if (block === undefined) {
      return null
    }

    const tree = await treeOf(block.pageId)
    const fresh = tree.blocks.find((candidate) => candidate.id === block.id) ?? block

    return blockJson(tree, fresh, nested)
  }

  const insertDrafts = async (
    uuid: string | null,
    drafts: readonly [BlockDraft, ...BlockDraft[]],
    options: Fields,
  ) => {
    const before = options["before"] === true
    const found = await findBlock(uuid)

    if (found === null) {
      const page = await findPage(uuid)

      if (page === null) {
        throw new Error(`No block or page ${String(uuid)}`)
      }

      const tree = await treeOf(page.id)
      const top = tree.blocks.filter((block) => block.parentId === null)
      const last = before ? undefined : top.at(-1)

      return await dispatch([insertBlocks(page.id, null, last?.id, drafts)])
    }

    const { block, tree } = found

    if (options["sibling"] === true) {
      const siblings = tree.blocks.filter((other) => other.parentId === block.parentId)
      const previous = siblings[siblings.indexOf(block) - 1]
      const after = before ? previous?.id : block.id

      return await dispatch([insertBlocks(block.pageId, block.parentId, after, drafts)])
    }

    const children = tree.blocks.filter((other) => other.parentId === block.id)
    const last = options["end"] === true ? children.at(-1) : undefined

    return await dispatch([insertBlocks(block.pageId, block.id, last?.id, drafts)])
  }

  const withCustomId = async (draft: BlockDraft, custom: string | null): Promise<BlockDraft> => {
    if (custom === null) {
      return draft
    }

    const uuid = custom.trim().toLowerCase()

    if (!UUID.test(uuid)) {
      throw new Error(`Custom block UUID is not a UUID (${custom}).`)
    }

    if ((await findBlock(uuid)) !== null) {
      throw new Error(`Custom block UUID already exists (${uuid}).`)
    }

    return { text: draft.text, props: { ...draft.props, id: uuid }, children: draft.children }
  }

  const insertBlock = async (uuid: string | null, content: string, opts: Fields) => {
    const draft = await withCustomId(
      draftOf(content, record(opts["properties"])),
      text(opts["customUUID"]),
    )

    const events = await insertDrafts(uuid, [draft], opts)

    return await blockOut(created(events)[0])
  }

  const updateBlock = async (uuid: string | null, content: string, extra: Fields) => {
    const { block } = await mustBlock(uuid)
    const next = draftOf(content, extra)
    const commands: Command[] = []

    if (next.text !== block.text) {
      commands.push({
        _tag: "EditText",
        blockId: block.id,
        ...minimalEdit(block.text, next.text),
      })
    }

    for (const key of Object.keys(block.props)) {
      if (!(key in next.props)) {
        commands.push({
          _tag: "SetProperty",
          target: { _tag: "BlockTarget", blockId: block.id },
          key,
          value: null,
        })
      }
    }

    for (const [key, value] of Object.entries(next.props)) {
      if (key !== "" && block.props[key] !== value) {
        commands.push({
          _tag: "SetProperty",
          target: { _tag: "BlockTarget", blockId: block.id },
          key,
          value,
        })
      }
    }

    if (commands.length > 0) {
      await dispatch(commands)
    }

    return null
  }

  const setProperty = async (uuid: string | null, name: string | null, value: string | null) => {
    const { block } = await mustBlock(uuid)

    if (name === null || name === "") {
      return null
    }

    await dispatch([
      {
        _tag: "SetProperty",
        target: { _tag: "BlockTarget", blockId: block.id },
        key: kebab(name),
        value,
      },
    ])

    return null
  }

  const createPage = async (title: string | null, props: Fields, opts: Fields) => {
    if (title === null || title.trim() === "") {
      return null
    }

    const existing = await pageByName(title)

    const page =
      existing ??
      (await (async () => {
        const pageProps: Props = Object.fromEntries(
          Object.entries(props).map(([key, value]) => [kebab(key), valueText(value)]),
        )

        const events = await dispatch([{ _tag: "CreatePage", title, props: pageProps }])

        const made = events.flatMap((event) =>
          event._tag === "PageUpserted" ? [event.page] : [],
        )[0]

        if (made !== undefined && opts["createFirstBlock"] !== false) {
          await dispatch([{ _tag: "InsertBlock", pageId: made.id, parentId: null, text: "" }])
        }

        return made ?? null
      })())

    if (page !== null && opts["redirect"] === true) {
      bridge.navigate({ _tag: "Page", name: page.name })
    }

    return page === null ? null : pageJson(page)
  }

  const currentPage = async () => {
    const route = bridge.route()

    return route._tag === "Page" ? await pageByName(route.name) : null
  }

  const insertAtCursor = async (insert: string) => {
    const live = editingBlock()

    if (live !== null) {
      const { from, to } = live.view.state.selection.main
      live.view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input",
      })

      return null
    }

    const saved = lastCursor.current

    if (saved === null) {
      return null
    }

    const { block } = await mustBlock(saved.blockId)
    const content = contentOf(block)
    const at = Math.min(saved.caret, content.length)
    await updateBlock(block.id, content.slice(0, at) + insert + content.slice(at), {})

    return null
  }

  const runQuery = async (query: string): Promise<QueryResult> =>
    await core((client) => Stream.runHead(client.WatchQuery({ query }))).then((head) =>
      Option.getOrElse(head, (): QueryResult => ({ _tag: "BlockRows", blocks: [] })),
    )

  const rowsOf = async (result: QueryResult) => {
    if (result._tag === "PageRows") {
      return []
    }

    const trees = new Map<string, Tree>()
    const out = []

    for (const block of result.blocks) {
      const tree = trees.get(block.pageId) ?? (await treeOf(block.pageId))
      trees.set(block.pageId, tree)
      out.push(blockJson(tree, block, false))
    }

    return out
  }

  const graphDb: GraphDb = {
    current: null,
    stale: new Set(),
    watching: false,
    queue: Promise.resolve(null),
  }

  const dirty = (pageId: PageId) => {
    if (graphDb.stale !== "all") {
      graphDb.stale.add(pageId)
    }
  }

  const markChanged = (events: readonly GraphEvent[]) => {
    for (const event of events) {
      switch (event._tag) {
        case "BlockUpserted": {
          dirty(event.block.pageId)
          break
        }

        case "BlockMoved": {
          dirty(event.pageId)
          const from = graphDb.current?.db.pageOf(numberOf(event.blockId)) ?? null

          if (from !== null) {
            dirty(from)
          }

          break
        }

        case "BlockDeleted": {
          dirty(event.pageId)
          break
        }

        case "PageUpserted": {
          if (graphDb.current?.db.hasPage(event.page) === true) {
            dirty(event.page.id)
          } else {
            graphDb.stale = "all"
          }

          break
        }

        case "PageDeleted": {
          graphDb.stale = "all"
          break
        }
      }
    }
  }

  const watchChanges = () => {
    if (graphDb.watching) {
      return
    }

    graphDb.watching = true
    void bridge
      .run(
        Effect.flatMap(CoreClient, (client) =>
          Stream.runForEach(client.WatchChanges(), ({ events }) =>
            Effect.sync(() => {
              markChanged(events)
            }),
          ),
        ),
      )
      .catch(() => null)
      .finally(() => {
        graphDb.watching = false
        graphDb.stale = "all"
      })
  }

  const build = async () => {
    const graph = bridge.graphName()
    watchChanges()
    graphDb.stale = new Set()

    const [files, { createLogseqDb }] = await Promise.all([
      core((client) => client.ExportPages({})),
      import("./datalog.ts"),
    ])

    graphDb.current = { graph, db: createLogseqDb(files) }

    return graphDb.current.db
  }

  const freshDb = async (): Promise<LogseqDb> => {
    const current = graphDb.current
    const stale = graphDb.stale

    if (current === null || current.graph !== bridge.graphName() || stale === "all") {
      return await build()
    }

    if (stale.size === 0) {
      return current.db
    }

    graphDb.stale = new Set()

    const trees = await Promise.all(
      [...stale].map(async (pageId) => await treeOf(pageId).catch(() => null)),
    )

    if (trees.some((tree) => tree === null)) {
      return await build()
    }

    try {
      current.db.update(trees.flatMap((tree) => (tree === null ? [] : [tree])))

      return current.db
    } catch {
      return await build()
    }
  }

  const logseqDb = async () => {
    const next = graphDb.queue.then(freshDb, freshDb)
    graphDb.queue = next

    return await next
  }

  const inputContext = async (): Promise<InputContext> => {
    const now = new Date()
    const route = bridge.route()
    const today = now.getFullYear() * 10_000 + (now.getMonth() + 1) * 100 + now.getDate()

    const pageName = await Match.value(route).pipe(
      Match.tag(
        "Page",
        async ({ name }) => (await pageByName(name))?.name ?? normalizePageName(name),
      ),
      Match.tag(
        "Journals",
        async () => (await pages()).find((page) => page.journalDay === today)?.name ?? null,
      ),
      Match.orElse(() => null),
    )

    const live = editingBlock()
    const found = live === null ? null : await findBlock(live.blockId)

    return {
      now,
      currentPage: pageName,
      currentBlock:
        found === null
          ? null
          : {
              eid: numberOf(found.block.id),
              parent: numberOf(found.block.parentId ?? found.block.pageId),
              page: found.tree.page.name,
            },
    }
  }

  const datalog = async (query: string, inputs: readonly unknown[]) => {
    const db = await logseqDb()
    const { readEdn } = await import("./datalog.ts")
    const context = await inputContext()
    const given = [...inputs]

    while (given.length > 0 && (given.at(-1) === null || given.at(-1) === undefined)) {
      given.pop()
    }

    return db.query(query, given.map(resolveInput(context, (edn) => readEdn([edn])[0])))
  }

  const registerSimple = (pid: string, args: readonly unknown[]) => {
    const [options, action] = list(args[0])
    const opts = record(options)
    const key = text(opts["key"])
    const eventKey = text(list(action)[1])

    if (key === null || eventKey === null) {
      return null
    }

    const command: PluginCommand = {
      pid,
      key,
      label: text(opts["label"]) ?? text(opts["desc"]) ?? key,
      type: text(opts["type"]) ?? "$commands$",
      keybinding: keybindingOf(record(opts["keybinding"])),
      palette: args[1] === true,
      eventKey,
      clearSelection: record(opts["extras"])["clearSelection"] === true,
    }

    registry.set(pluginCommands, [
      ...registry.get(pluginCommands).filter((other) => !(other.pid === pid && other.key === key)),
      command,
    ])

    return null
  }

  const routeInfo = () => routePayload(bridge.route())

  const pushState = (to: string | null, name: string | null) => {
    const route = Match.value(to).pipe(
      Match.when("page", (): Route | null => (name === null ? null : { _tag: "Page", name })),
      Match.whenOr("home", "all-journals", (): Route => ({ _tag: "Journals" })),
      Match.when("all-pages", (): Route => ({ _tag: "AllPages" })),
      Match.when("graph", (): Route => ({ _tag: "Graph" })),
      Match.orElse(() => null),
    )

    if (route !== null) {
      bridge.navigate(route)
    }

    return null
  }

  const userConfigs = () => {
    const graph = bridge.graphName()

    return {
      preferredThemeMode: bridge.themeMode(),
      preferredFormat: "markdown",
      preferredDateFormat: "MMM do, yyyy",
      preferredStartOfWeek: 6,
      preferredLanguage: navigator.language,
      preferredWorkflow: "todo",
      currentGraph: graph === null ? null : `logseq_local_${graph}`,
      showBrackets: bridge.showBrackets(),
      enabledFlashcards: false,
      enabledJournals: true,
      me: {},
    }
  }

  return (host: Host): Api => {
    const table: Handlers = {
      ...assetsApi(bridge.assets, bridge.graphName),
      set_sdk_metadata: (pid, [meta]) => {
        host.setSdk(pid, text(record(meta)["version"]) ?? "0.0.0")
      },
      install_plugin_hook: (_, [pid, hook]) => {
        host.installHook(text(pid) ?? "", text(hook) ?? "")
      },
      uninstall_plugin_hook: (_, [pid, hook]) => {
        host.uninstallHook(text(pid) ?? "", text(hook) ?? "")
      },
      should_exec_plugin_hook: (_, [, hook]) => host.wants(text(hook) ?? ""),
      register_plugin_slash_command: (_, [pid, command]) => {
        const [label, actions] = list(command)
        const owner = text(pid)
        const name = text(label)

        if (owner === null || name === null) {
          return null
        }

        registry.set(slashCommands, [
          ...registry
            .get(slashCommands)
            .filter((other) => !(other.pid === owner && other.label === name)),
          { pid: owner, label: name, actions: list(actions).map((action) => list(action)) },
        ])

        return true
      },
      unregister_plugin_slash_command: (_, [pid, label]) => {
        registry.set(
          slashCommands,
          registry
            .get(slashCommands)
            .filter((other) => !(other.pid === pid && other.label === label)),
        )
      },
      register_plugin_simple_command: (_, [pid, ...rest]) => registerSimple(text(pid) ?? "", rest),
      unregister_plugin_simple_command: (_, [pid, key]) => {
        registry.set(
          pluginCommands,
          registry.get(pluginCommands).filter((other) => !(other.pid === pid && other.key === key)),
        )
      },
      register_plugin_ui_item: (_, [pid, type, options]) => {
        const owner = text(pid)
        const opts = record(options)
        const key = text(opts["key"])

        if (owner === null || key === null || (type !== "toolbar" && type !== "pagebar")) {
          return null
        }

        const item = { pid: owner, key, type, template: text(opts["template"]) ?? "" } as const
        const items = registry.get(uiItems)
        const at = items.findIndex((other) => other.pid === owner && other.key === key)
        registry.set(
          uiItems,
          at === -1 ? [...items, item] : items.map((other, index) => (index === at ? item : other)),
        )

        return null
      },
      get_info: (_, [key]) => {
        const info = { version: logseqVersion, supportDb: false, isDbGraph: false }
        const name = text(key)

        return name === null
          ? info
          : (Object.entries(info).find(([field]) => field === name)?.[1] ?? null)
      },
      get_user_configs: () => userConfigs(),
      get_app_info: () => ({ version: logseqVersion, supportDb: false }),
      invoke_external_plugin_cmd: (_, [pid, , key]) => {
        const owner = scalarText(pid)
        const name = scalarText(key)

        if (owner === null || name === null) {
          return null
        }

        const command = registry
          .get(pluginCommands)
          .find((one) => one.pid === owner && (one.key === name || one.key === `${name}_${owner}`))

        if (command !== undefined) {
          host.hook("editor", command.eventKey, {}, command.pid)
        }

        return null
      },
      check_current_is_db_graph: () => false,
      get_current_graph: () => {
        const name = bridge.graphName()

        return name === null ? null : { url: `logseq_local_${name}`, name, path: name }
      },
      get_current_route: () => routeInfo(),
      push_state: (_, [to, params]) => pushState(text(to), text(record(params)["name"])),
      replace_state: (_, [to, params]) => pushState(text(to), text(record(params)["name"])),
      get_state_from_store: (_, [path]) =>
        Match.value(texts(path).join("/")).pipe(
          Match.when("ui/theme", () => bridge.themeMode()),
          Match.when("ui/left-sidebar-open?", () => bridge.sidebarOpen("left")),
          Match.when("ui/sidebar-open?", () => bridge.sidebarOpen("right")),
          Match.when("editor/editing?", () => editingBlock() !== null),
          Match.orElse(() => null),
        ),
      set_left_sidebar_visible: (_, [visible]) => {
        bridge.setSidebar(
          "left",
          visible === "toggle" ? !bridge.sidebarOpen("left") : visible === true,
        )
      },
      set_right_sidebar_visible: (_, [visible]) => {
        bridge.setSidebar(
          "right",
          visible === "toggle" ? !bridge.sidebarOpen("right") : visible === true,
        )
      },
      open_external_link: (_, [url]) => {
        window.open(text(url) ?? "", "_blank", "noopener")
      },
      show_msg: (_, [content]) => {
        bridge.notify(valueText(content))

        return `msg-${Date.now()}`
      },
      close_msg: () => null,
      query_element_rect: (_, [selector]) => elementRect(text(selector)),
      query_element_by_id: (_, [id]) => {
        const element = elementById(text(id))

        return element === null ? false : `${element.tagName}#${element.id}`
      },
      check_slot_valid: (_, [slot]) => elementById(text(slot)) !== null,
      resolve_theme_css_props_vals: (_, [props]) => {
        const style = getComputedStyle(document.documentElement)
        const names = texts(props)

        return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
      },
      get_block: async (_, [target, options]) => {
        const found = await findBlock(uuidIn(target))

        return found === null
          ? null
          : blockJson(found.tree, found.block, record(options)["includeChildren"] === true)
      },
      get_page: async (_, [target]) => {
        const page = await findPage(uuidIn(target))

        return page === null ? null : pageJson(page)
      },
      get_all_pages: async () => (await pages()).map(pageJson),
      get_current_page: async () => {
        const page = await currentPage()

        return page === null ? null : pageJson(page)
      },
      get_current_block: async () => {
        const live = editingBlock()

        return live === null
          ? null
          : await findBlock(live.blockId).then((found) =>
              found === null ? null : blockJson(found.tree, found.block, false),
            )
      },
      get_selected_blocks: async () => {
        const ids = bridge.selectedBlocks()

        if (ids.length === 0) {
          return null
        }

        const found = await Promise.all(ids.map(findBlock))

        return found.flatMap((one) => (one === null ? [] : [blockJson(one.tree, one.block, false)]))
      },
      get_current_page_blocks_tree: async () => {
        const page = await currentPage()

        return page === null ? [] : treeJson(await treeOf(page.id))
      },
      get_page_blocks_tree: async (_, [target]) => {
        const page = await findPage(uuidIn(target))

        return page === null ? null : treeJson(await treeOf(page.id))
      },
      get_previous_sibling_block: async (_, [target]) => {
        const { block, tree } = await mustBlock(uuidIn(target))
        const siblings = tree.blocks.filter((other) => other.parentId === block.parentId)
        const previous = siblings[siblings.indexOf(block) - 1]

        return previous === undefined ? null : blockJson(tree, previous, false)
      },
      get_next_sibling_block: async (_, [target]) => {
        const { block, tree } = await mustBlock(uuidIn(target))
        const siblings = tree.blocks.filter((other) => other.parentId === block.parentId)
        const next = siblings[siblings.indexOf(block) + 1]

        return next === undefined ? null : blockJson(tree, next, false)
      },
      insert_block: async (_, [target, content, options]) =>
        await insertBlock(uuidIn(target), text(content) ?? "", record(options)),
      insert_batch_block: async (_, [target, batch, options]) => {
        const drafts = Option.getOrElse(asList(batch), () => [batch]).map((one) =>
          draftTree(batchOf(record(one))),
        )

        const [first, ...rest] = drafts

        if (first === undefined) {
          return null
        }

        const events = await insertDrafts(uuidIn(target), [first, ...rest], record(options))
        const parents = new Set(created(events).map((block) => block.id))

        const top = created(events).filter(
          (block) => block.parentId === null || !parents.has(block.parentId),
        )

        return await Promise.all(top.map(async (block) => await blockOut(block)))
      },
      update_block: async (_, [target, content, options]) =>
        await updateBlock(
          uuidIn(target),
          text(content) ?? "",
          record(record(options)["properties"]),
        ),
      remove_block: async (_, [target]) => {
        const { block } = await mustBlock(uuidIn(target))
        await dispatch([{ _tag: "DeleteBlocks", blockIds: [block.id] }])

        return null
      },
      move_block: async (_, [source, target, options]) => {
        const moving = await mustBlock(uuidIn(source))
        const { block, tree } = await mustBlock(uuidIn(target))
        const opts = record(options)

        if (opts["children"] === true) {
          await dispatch([moveBlocks([moving.block.id], block.id, undefined)])

          return null
        }

        const siblings = tree.blocks.filter(
          (other) => other.parentId === block.parentId && other.id !== moving.block.id,
        )

        const previous = siblings[siblings.indexOf(block) - 1]
        const after = opts["before"] === true ? previous?.id : block.id
        await dispatch([moveBlocks([moving.block.id], block.parentId, after)])

        return null
      },
      prepend_block_in_page: async (_, [target, content, options]) => {
        const page = (await findPage(uuidIn(target))) ?? (await currentPage())

        if (page === null) {
          return null
        }

        const draft = draftOf(text(content) ?? "", record(record(options)["properties"]))
        const events = await dispatch([insertBlocks(page.id, null, undefined, [draft])])

        return await blockOut(created(events)[0])
      },
      append_block_in_page: async (_, [target, content, options]) => {
        const name = text(target)

        const page =
          (await findPage(uuidIn(target))) ??
          (name !== null && Option.isNone(decodePageId(name))
            ? await createPage(name, {}, { createFirstBlock: false }).then(
                async () => await pageByName(name),
              )
            : await currentPage())

        if (page === null) {
          return null
        }

        return await insertBlock(page.id, text(content) ?? "", record(options))
      },
      create_page: async (_, [name, props, options]) =>
        await createPage(text(name), record(props), record(options)),
      create_journal_page: () => null,
      delete_page: async (_, [target]) => {
        const page = await findPage(uuidIn(target))

        if (page !== null) {
          await dispatch([{ _tag: "DeletePage", pageId: page.id }])
        }

        return null
      },
      rename_page: async (_, [target, title]) => {
        const page = await findPage(uuidIn(target))
        const name = text(title)

        if (page !== null && name !== null) {
          await dispatch([{ _tag: "RenamePage", pageId: page.id, title: name }])
        }

        return null
      },
      upsert_block_property: async (_, [target, key, value]) =>
        await setProperty(uuidIn(target), text(key), valueText(value)),
      remove_block_property: async (_, [target, key]) =>
        await setProperty(uuidIn(target), text(key), null),
      get_block_property: async (_, [target, key]) => {
        const { block } = await mustBlock(uuidIn(target))
        const name = text(key) ?? ""

        return block.props[name] ?? block.props[kebab(name)] ?? null
      },
      get_block_properties: async (_, [target]) => {
        const found = await findBlock(uuidIn(target))

        return found === null ? null : properties(found.block.props)
      },
      get_page_properties: async (_, [target]) => {
        const page = await findPage(uuidIn(target))

        return page === null ? null : properties(page.props)
      },
      set_block_collapsed: async (_, [target, options]) => {
        const { block } = await mustBlock(uuidIn(target))

        const flag = Option.match(asFields(options), {
          onNone: () => options,
          onSome: (fields) => fields["flag"],
        })

        const collapsed = flag === "toggle" ? !block.collapsed : flag === true
        await dispatch([{ _tag: "SetCollapsed", blockId: block.id, collapsed }])

        return null
      },
      edit_block: async (_, [target, options]) => {
        const { block } = await mustBlock(uuidIn(target))
        bridge.editBlock(block.id, amount(record(options)["pos"]))

        return null
      },
      exit_editing_mode: () => {
        bridge.exitEditing()
      },
      check_editing: () => editingBlock()?.blockId ?? false,
      insert_at_editing_cursor: async (_, [content]) => await insertAtCursor(text(content) ?? ""),
      restore_editing_cursor: () => {
        const saved = lastCursor.current

        if (saved !== null && editingBlock() === null) {
          bridge.editBlock(saved.blockId, saved.caret)
        }

        return null
      },
      get_editing_cursor_position: () => cursorPosition(),
      get_editing_block_content: () => editingBlock()?.view.state.doc.toString() ?? "",
      open_in_right_sidebar: async (_, [target]) => {
        const found = await findBlock(uuidIn(target))

        if (found !== null) {
          bridge.navigate({ _tag: "SidebarBlock", blockId: found.block.id })

          return
        }

        const page = await findPage(uuidIn(target))

        if (page !== null) {
          bridge.navigate({ _tag: "SidebarPage", name: page.name })
        }
      },
      scroll_to_block_in_page: async (_, [target, blockTarget]) => {
        const found = await findBlock(uuidIn(blockTarget ?? target))

        if (found !== null) {
          bridge.navigate({
            _tag: "Zoom",
            pageId: found.block.pageId,
            blockId: found.block.id,
          })

          return
        }

        const page = await findPage(uuidIn(target))

        if (page !== null) {
          bridge.navigate({ _tag: "Page", name: page.name })
        }
      },
      new_block_uuid: () => crypto.randomUUID(),
      git_exec_command: async (_, [args]) => {
        const argv = list(args).map(valueText)

        return argv.length > 0 ? await bridge.git.exec(argv) : null
      },
      git_load_ignore_file: async () => await bridge.git.loadIgnore(),
      git_save_ignore_file: async (_, [content]) => {
        const ignore = text(content)

        if (ignore !== null) {
          await bridge.git.saveIgnore(ignore)
        }

        return null
      },
      datascript_query: async (_, [query, ...inputs]) => {
        const datalogText = text(query)

        return datalogText === null ? null : await datalog(datalogText, inputs)
      },
      q: async (_, [query]) => {
        const dsl = text(query)

        if (dsl === null) {
          return null
        }

        const result = await runQuery(dsl)

        return result._tag === "PageRows" ? result.pages.map(pageJson) : await rowsOf(result)
      },
    }

    return async (pid, method, args) => {
      const snake = snakeCase(method.startsWith("_call") ? method : method.replace(/^[_$]+/u, ""))
      const run = table[snake] ?? table[snake.replace(/^(ui|git|assets|utils|experiments)_/u, "")]

      if (run === undefined) {
        throw unsupported(method)
      }

      return await run(pid, args)
    }
  }
}
