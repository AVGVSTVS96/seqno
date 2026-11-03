import pluginsCss from "./plugins.css?inline"
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  IconCloudDownload,
  IconPalette,
  IconPuzzle,
  IconSearch,
  IconSettings,
  IconStar,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { Effect } from "effect"
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity"
import { useContext, useState, type ReactNode } from "react"
import {
  chosenThemes,
  install,
  installedPlugins,
  loadMarket,
  local,
  pluginSettings,
  running,
  runtimeThemes,
  setEnabled,
  settingsFor,
  uninstall,
  type ChosenTheme,
  type MarketItem,
  type PluginInfo,
  type PluginTheme,
} from "@seqno/plugins"
import { theme } from "../../atoms.ts"
import { notify } from "../shell/Notices.tsx"
import { closeDialogOf, Dialog, openDialog } from "../shell/popover.tsx"

const dialogId = "seqno-plugins"

export const openPlugins = () => openDialog(dialogId)

type Tab = "installed" | "marketplace"
type Kind = "plugins" | "themes"

const market = Atom.make(Effect.tryPromise(() => loadMarket())).pipe(Atom.keepAlive)

const compact = (count: number) =>
  count >= 1000 ? `${(count / 1000).toFixed(count >= 100_000 ? 0 : 1)}k` : String(count)

const matches = (query: string, ...fields: ReadonlyArray<string>) => {
  const needle = query.trim().toLowerCase()
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle))
}

const Icon = ({
  src,
  theme: isTheme,
}: {
  readonly src: string | null
  readonly theme: boolean
}) => {
  const [failed, setFailed] = useState(false)
  return src === null || failed ? (
    <span className="plugin-icon plugin-icon-empty" aria-hidden>
      {isTheme ? <IconPalette size={28} /> : <IconPuzzle size={28} />}
    </span>
  ) : (
    <img className="plugin-icon" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  )
}

const Card = ({
  title,
  description,
  author,
  id,
  icon,
  theme: isTheme,
  footer,
}: {
  readonly title: string
  readonly description: string
  readonly author: string
  readonly id: string
  readonly icon: string | null
  readonly theme: boolean
  readonly footer: ReactNode
}) => (
  <li className="plugin-card cp__plugins-item-card" aria-label={title}>
    <div className="plugin-card-head">
      <Icon src={icon} theme={isTheme} />
      <div className="plugin-card-text">
        <h3 className="plugin-card-title">{title}</h3>
        <p className="plugin-card-description">{description}</p>
      </div>
    </div>
    <div className="plugin-card-meta">
      <span>{author}</span>
      <span>ID: {id}</span>
    </div>
    <div className="plugin-card-footer">{footer}</div>
  </li>
)

const MarketCard = ({ item }: { readonly item: MarketItem }) => {
  const registry = useContext(RegistryContext)
  const installed = useAtomValue(installedPlugins).some((plugin) => plugin.id === item.id)
  const [busy, setBusy] = useState(false)
  const add = () => {
    setBusy(true)
    install(registry, item)
      .catch((error: unknown) =>
        notify(
          registry,
          `${item.title} couldn't be installed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => setBusy(false))
  }
  return (
    <Card
      {...item}
      footer={
        <>
          <span className="plugin-stat" title="Stars">
            <IconStar size={16} aria-hidden />
            {compact(item.stars)}
          </span>
          <span className="plugin-stat" title="Downloads">
            <IconCloudDownload size={16} aria-hidden />
            {compact(item.downloads)}
          </span>
          <button
            type="button"
            className="plugin-action"
            disabled={installed || busy}
            onClick={add}
          >
            {installed ? "Installed" : busy ? "Installing…" : "Install"}
          </button>
        </>
      }
    />
  )
}

const isThemePackage = (plugin: PluginInfo) => plugin.themes.length > 0

const InstalledCard = ({ plugin }: { readonly plugin: PluginInfo }) => {
  const registry = useContext(RegistryContext)
  const enabled = useAtomValue(pluginSettings(plugin.id))["disabled"] !== true
  const status = useAtomValue(running)[plugin.id]?.status
  const openSettings = useAtomSet(settingsFor)
  const isTheme = isThemePackage(plugin)
  return (
    <Card
      {...plugin}
      icon={plugin.icon === null ? null : local(plugin.icon)}
      theme={isTheme}
      footer={
        <>
          {status?._tag === "Failed" ? (
            <span className="plugin-problem" role="status">
              Didn't load
            </span>
          ) : null}
          <span className="plugin-version">{plugin.version}</span>
          {isTheme ? null : (
            <button
              type="button"
              className="icon-button"
              aria-label={`${plugin.title} settings`}
              onClick={() => openSettings(plugin.id)}
            >
              <IconSettings size={18} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Uninstall ${plugin.title}`}
            onClick={() => void uninstall(registry, plugin.id)}
          >
            <IconTrash size={18} aria-hidden />
          </button>
          {isTheme ? null : (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`Enable ${plugin.title}`}
              className="switch"
              onClick={() => void setEnabled(registry, plugin.id, !enabled)}
            >
              <span className="switch-thumb" />
            </button>
          )}
        </>
      }
    />
  )
}

export const themeChosen = (
  chosen: { readonly light: ChosenTheme | null; readonly dark: ChosenTheme | null },
  entry: PluginTheme | null,
) =>
  entry === null
    ? chosen.light === null && chosen.dark === null
    : [chosen.light, chosen.dark].some((pick) => pick?.url === entry.url)

export const applyTheme = (registry: AtomRegistry.AtomRegistry, entry: PluginTheme | null) => {
  if (entry === null) return registry.set(chosenThemes, { light: null, dark: null })
  const pick = { pid: entry.pid, url: entry.url }
  if (entry.mode === null) return registry.set(chosenThemes, { light: pick, dark: pick })
  registry.set(chosenThemes, { ...registry.get(chosenThemes), [entry.mode]: pick })
  registry.set(theme, entry.mode)
}

const ThemeRow = ({ entry }: { readonly entry: PluginTheme | null }) => {
  const chosen = useAtomValue(chosenThemes)
  const registry = useContext(RegistryContext)
  const active = themeChosen(chosen, entry)
  const use = () => applyTheme(registry, entry)
  return (
    <li className="plugin-theme-row">
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className="plugin-theme"
        onClick={use}
      >
        <span className="plugin-theme-name">
          {entry === null ? "Logseq default theme" : entry.name}
        </span>
        {entry?.mode === null || entry === null ? null : (
          <span className="plugin-theme-mode">{entry.mode}</span>
        )}
      </button>
    </li>
  )
}

const Installed = ({ kind, query }: { readonly kind: Kind; readonly query: string }) => {
  const plugins = useAtomValue(installedPlugins)
  const themes = useAtomValue(runtimeThemes)
  const shown = plugins.filter(
    (plugin) =>
      (kind === "themes") === isThemePackage(plugin) &&
      matches(query, plugin.title, plugin.description, plugin.id),
  )
  return (
    <>
      {kind === "themes" ? (
        <ul role="radiogroup" aria-label="Theme" className="plugin-themes cp__themes-installed">
          <ThemeRow entry={null} />
          {themes.map((entry) => (
            <ThemeRow key={entry.url} entry={entry} />
          ))}
        </ul>
      ) : null}
      {shown.length === 0 && kind === "plugins" ? (
        <p className="plugins-empty">Nothing found.</p>
      ) : (
        <ul className="plugin-grid">
          {shown.map((plugin) => (
            <InstalledCard key={plugin.id} plugin={plugin} />
          ))}
        </ul>
      )}
    </>
  )
}

const Marketplace = ({ kind, query }: { readonly kind: Kind; readonly query: string }) =>
  AsyncResult.match(useAtomValue(market), {
    onInitial: () => <p className="plugins-empty">Loading the marketplace…</p>,
    onFailure: () => <p className="plugins-empty">The marketplace couldn't be reached.</p>,
    onSuccess: ({ value }) => {
      const shown = value
        .filter(
          (item) =>
            item.theme === (kind === "themes") &&
            matches(query, item.title, item.description, item.author, item.id),
        )
        .toSorted((left, right) => right.downloads - left.downloads)
      return shown.length === 0 ? (
        <p className="plugins-empty">Nothing found.</p>
      ) : (
        <ul className="plugin-grid">
          {shown.map((item) => (
            <MarketCard key={item.id} item={item} />
          ))}
        </ul>
      )
    },
  })

const Kinds = ({
  kind,
  plugins,
  themes,
  onKind,
}: {
  readonly kind: Kind
  readonly plugins: number
  readonly themes: number
  readonly onKind: (kind: Kind) => void
}) => (
  <div role="radiogroup" aria-label="Kind" className="plugins-kinds">
    {(["plugins", "themes"] as const).map((one) => (
      <button
        key={one}
        type="button"
        role="radio"
        aria-checked={kind === one}
        className="plugins-kind"
        onClick={() => onKind(one)}
      >
        {one === "plugins" ? (
          <IconPuzzle size={16} aria-hidden />
        ) : (
          <IconPalette size={16} aria-hidden />
        )}
        {one === "plugins" ? `Plugins (${plugins})` : `Themes (${themes})`}
      </button>
    ))}
  </div>
)

const InstalledKinds = (props: { readonly kind: Kind; readonly onKind: (kind: Kind) => void }) => {
  const installed = useAtomValue(installedPlugins)
  const themes = installed.filter(isThemePackage).length
  return <Kinds {...props} plugins={installed.length - themes} themes={themes} />
}

const MarketKinds = (props: { readonly kind: Kind; readonly onKind: (kind: Kind) => void }) => {
  const listed = AsyncResult.getOrElse(useAtomValue(market), (): ReadonlyArray<MarketItem> => [])
  const themes = listed.filter((item) => item.theme).length
  return <Kinds {...props} plugins={listed.length - themes} themes={themes} />
}

const Body = () => {
  const [tab, setTab] = useState<Tab>("installed")
  const [kind, setKind] = useState<Kind>("plugins")
  const [query, setQuery] = useState("")
  return (
    <>
      <style href="seqno/plugins" precedence="app">
        {pluginsCss}
      </style>
      <div className="plugins-head">
        <h1 className="plugins-title">Plugins</h1>
        <div role="tablist" aria-label="Plugins" className="plugins-tabs tabs">
          {(["installed", "marketplace"] as const).map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={tab === one}
              className="plugins-tab"
              onClick={() => setTab(one)}
            >
              {one === "installed" ? "Installed" : "Marketplace"}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Close"
          className="icon-button plugins-close"
          onClick={(event) => closeDialogOf(event.currentTarget)}
        >
          <IconX size={18} aria-hidden />
        </button>
      </div>
      <div className="plugins-bar">
        {tab === "installed" ? (
          <InstalledKinds kind={kind} onKind={setKind} />
        ) : (
          <MarketKinds kind={kind} onKind={setKind} />
        )}
        <label className="plugins-search">
          <IconSearch size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search plugins"
            aria-label="Search plugins"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="plugins-body">
        {tab === "installed" ? (
          <Installed kind={kind} query={query} />
        ) : (
          <Marketplace kind={kind} query={query} />
        )}
      </div>
    </>
  )
}

export const PluginsDialog = () => {
  const [opened, setOpened] = useState(0)
  return (
    <Dialog
      id={dialogId}
      label="Plugins"
      className="plugins-dialog cp__plugins-page"
      onClose={() => setOpened(opened + 1)}
    >
      <Body key={opened} />
    </Dialog>
  )
}
