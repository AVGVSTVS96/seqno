declare const build: { readonly revision: string; readonly files: ReadonlyArray<string> }

const shellPrefix = "seqno-app-"

const copied = new Set(["script", "style", "font"])

const bare = (url: string) => {
  const parsed = new URL(url)
  parsed.search = ""
  parsed.hash = ""
  return parsed.href
}

const serve = (worker: ServiceWorkerGlobalScope) => {
  const scope = worker.registration.scope
  const params = new URL(worker.location.href).searchParams
  const pluginPath = params.get("plugins")
  const pluginCache = params.get("cache")
  const pluginRoot = pluginPath === null ? null : new URL(pluginPath, scope).href
  const shell = `${shellPrefix}${build.revision}`
  const files = new Set(build.files.map((file) => new URL(file, scope).href))
  const page = new URL("index.html", scope).href

  const keep = async (url: string, response: Response) => {
    if (pluginCache === null) return
    const cache = await caches.open(pluginCache)
    await cache.put(bare(url), response)
  }

  const pluginFile = async (request: Request) => {
    const kept = await caches.match(request, { ignoreSearch: true, ignoreVary: true })
    if (kept !== undefined) return kept
    const response = await fetch(request)
    if (response.ok) await keep(request.url, response.clone())
    return response
  }

  const fromPlugin = async (clientId: string) => {
    const client = await worker.clients.get(clientId)
    return pluginRoot !== null && client?.url.startsWith(pluginRoot) === true
  }

  const elsewhereFile = async (request: Request, clientId: string) => {
    const kept = await caches.match(request, { ignoreVary: true })
    if (kept !== undefined) return kept
    const response = await fetch(request)
    if ((response.ok || response.type === "opaque") && (await fromPlugin(clientId))) {
      await keep(request.url, response.clone())
    }
    return response
  }

  const shellFile = async (request: Request) =>
    (await caches.match(request, { cacheName: shell, ignoreVary: true })) ?? fetch(request)

  const navigation = (request: Request) =>
    fetch(request).catch(async (error: unknown) => {
      const kept = await caches.match(page, { cacheName: shell })
      if (kept === undefined) throw error
      return kept
    })

  worker.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(shell)
        .then((cache) => cache.addAll([...files]))
        .then(() => worker.skipWaiting()),
    )
  })

  worker.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith(shellPrefix) && name !== shell)
              .map((name) => caches.delete(name)),
          ),
        )
        .then(() => worker.clients.claim()),
    )
  })

  worker.addEventListener("fetch", (event) => {
    const { request } = event
    if (request.method !== "GET") return
    if (pluginRoot !== null && request.url.startsWith(pluginRoot))
      return event.respondWith(pluginFile(request))
    if (copied.has(request.destination) && new URL(request.url).origin !== worker.location.origin)
      return event.respondWith(elsewhereFile(request, event.clientId))
    if (!request.url.startsWith(scope)) return
    if (request.mode === "navigate") return event.respondWith(navigation(request))
    if (files.has(bare(request.url))) return event.respondWith(shellFile(request))
  })
}

if (self instanceof ServiceWorkerGlobalScope) serve(self)
