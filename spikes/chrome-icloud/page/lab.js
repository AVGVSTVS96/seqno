import { makeUpdate, verifyUpdate, stats } from './content.js'

const idb = (mode, op) =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('seqno-spike', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('handles')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('handles', mode)
      const req = op(tx.objectStore('handles'))
      tx.oncomplete = () => {
        open.result.close()
        resolve(req.result)
      }
      tx.onerror = () => reject(tx.error)
    }
  })

const handles = {}
const remember = async (key, handle) => {
  await idb('readwrite', (s) => s.put(handle, key))
  handles[key] = handle
  return { key, kind: handle.kind, name: handle.name }
}

const ready = idb('readonly', (s) => s.getAllKeys()).then((keys) =>
  Promise.all(keys.map(async (k) => (handles[k] = await idb('readonly', (s) => s.get(k))))),
)

const dirAt = async (key, path, create = false) => {
  let dir = handles[key]
  for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

const log = (x) => (document.querySelector('#log').textContent += JSON.stringify(x) + '\n')

document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  const key = document.body.dataset.dropKey ?? 'icloud'
  const pending = [...e.dataTransfer.items].map((i) => i.getAsFileSystemHandle())
  window.dropResult = Promise.all(pending)
    .then(([h]) => remember(key, h))
    .catch((err) => ({ error: `${err.name}: ${err.message}` }))
  window.dropResult.then(log)
})

document.querySelector('#pick').onclick = () => {
  window.pickResult = showDirectoryPicker({ id: 'seqno', mode: 'readwrite' })
    .then((h) => remember('icloud', h))
    .catch((err) => ({ error: `${err.name}: ${err.message}` }))
  window.pickResult.then(log)
}

document.querySelector('#grant').onclick = (e) => {
  const key = e.target.dataset.key ?? 'icloud'
  window.grantResult = handles[key]
    .requestPermission({ mode: 'readwrite' })
    .catch((err) => `${err.name}: ${err.message}`)
  window.grantResult.then((r) => log({ grant: key, result: r }))
}

const perm = async (key) => {
  const h = handles[key]
  if (!h) return null
  return { name: h.name, read: await h.queryPermission({ mode: 'read' }), readwrite: await h.queryPermission({ mode: 'readwrite' }) }
}

const writeOne = async (dir, name, data) => {
  const t0 = performance.now()
  const fh = await dir.getFileHandle(name, { create: true })
  const t1 = performance.now()
  const w = await fh.createWritable()
  const t2 = performance.now()
  await w.write(data)
  const t3 = performance.now()
  await w.close()
  const t4 = performance.now()
  return { open: t1 - t0, create: t2 - t1, write: t3 - t2, close: t4 - t3, total: t4 - t0 }
}

const writeBench = async ({ key, path, sizes, n, seed }) => {
  const dir = await dirAt(key, path, true)
  const out = {}
  for (const size of sizes) {
    const runs = []
    for (let i = 0; i < n; i++) runs.push(await writeOne(dir, `${i}-${size}.loro`, makeUpdate(seed + i, size)))
    out[size] = Object.fromEntries(['total', 'open', 'create', 'write', 'close'].map((k) => [k, stats(runs.map((r) => r[k]))]))
  }
  return out
}

const writeMany = async ({ key, path, sizes, seed }) => {
  const dir = await dirAt(key, path, true)
  const t0 = performance.now()
  for (const [i, size] of sizes.entries()) await writeOne(dir, `${i}-${size}.loro`, makeUpdate(seed + i, size))
  return { files: sizes.length, ms: Math.round(performance.now() - t0) }
}

const list = async (dir) => {
  const entries = []
  for await (const entry of dir.values()) entries.push(entry)
  return entries
}

const readEntry = async (entry) => {
  try {
    const file = await entry.getFile()
    const bytes = new Uint8Array(await file.arrayBuffer())
    return { size: file.size, read: bytes.length, ok: verifyUpdate(bytes) }
  } catch (err) {
    return { error: `${err.name}: ${err.message}` }
  }
}

const pool = async (items, concurrency, fn) => {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

const summarize = (results) => ({
  ok: results.filter((r) => r.ok).length,
  empty: results.filter((r) => r.read === 0).length,
  corrupt: results.filter((r) => r.read > 0 && !r.ok).length,
  errors: [...new Set(results.filter((r) => r.error).map((r) => r.error))],
  errorCount: results.filter((r) => r.error).length,
})

const readBench = async ({ key, path, concurrency }) => {
  const dir = await dirAt(key, path)
  const t0 = performance.now()
  const entries = (await list(dir)).filter((e) => e.kind === 'file' && e.name.endsWith('.loro'))
  const t1 = performance.now()
  const results = await pool(entries, concurrency, readEntry)
  const t2 = performance.now()
  return { files: entries.length, listMs: Math.round(t1 - t0), readMs: Math.round(t2 - t1), concurrency, ...summarize(results) }
}

const files = {}

const getFileOnly = async ({ key, path, name }) => {
  const dir = await dirAt(key, path)
  const t0 = performance.now()
  try {
    const file = await (await dir.getFileHandle(name)).getFile()
    files[name] = file
    return { name, getFileMs: Math.round(performance.now() - t0), size: file.size, lastModified: file.lastModified }
  } catch (err) {
    return { name, getFileMs: Math.round(performance.now() - t0), error: `${err.name}: ${err.message}` }
  }
}

const readHeld = async ({ name }) => {
  const t0 = performance.now()
  try {
    const bytes = new Uint8Array(await files[name].arrayBuffer())
    return { name, readMs: Math.round(performance.now() - t0), read: bytes.length, ok: verifyUpdate(bytes) }
  } catch (err) {
    return { name, readMs: Math.round(performance.now() - t0), error: `${err.name}: ${err.message}` }
  }
}

const listNames = async ({ key, path }) => {
  const dir = await dirAt(key, path)
  return (await list(dir)).map((e) => `${e.kind}:${e.name}`).sort()
}

let records = []
let observer

const observeStart = async ({ key, path }) => {
  if (!('FileSystemObserver' in self)) return { supported: false }
  records = []
  observer = new FileSystemObserver((batch) => {
    const t = Date.now()
    for (const r of batch) records.push({ t, type: r.type, path: r.relativePathComponents.join('/'), from: r.relativePathMovedFrom?.join('/') })
  })
  await observer.observe(await dirAt(key, path), { recursive: true })
  return { supported: true }
}

const observeTake = () => {
  const out = records
  records = []
  return out
}

let polling

const pollStart = async ({ key, path, intervalMs }) => {
  const dir = await dirAt(key, path)
  const seen = new Map()
  const costs = []
  let stop = false
  const loop = (async () => {
    while (!stop) {
      const t0 = performance.now()
      for (const e of await list(dir)) if (!seen.has(e.name)) seen.set(e.name, Date.now())
      costs.push(performance.now() - t0)
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  })()
  polling = async () => {
    stop = true
    await loop
    return { firstSeen: Object.fromEntries(seen), pollCost: stats(costs) }
  }
}

const pollStop = () => polling()

window.lab = { ready, perm, writeBench, writeMany, readBench, getFileOnly, readHeld, listNames, observeStart, observeTake, pollStart, pollStop }
