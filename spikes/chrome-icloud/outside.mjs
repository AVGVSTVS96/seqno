import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeUpdate, sizesFor, verifyUpdate } from './page/content.js'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const writeAtomic = (dir, name, data) => {
  const tmp = join(dir, `.${name}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, join(dir, name))
}

export const genFiles = (dir, n, seed, min, max) => {
  mkdirSync(dir, { recursive: true })
  const sizes = sizesFor(seed, n, min, max)
  sizes.forEach((size, i) => writeAtomic(dir, `${i}-${size}.loro`, makeUpdate(seed + i, size)))
  return sizes.map((size, i) => `${i}-${size}.loro`)
}

export const verifyDir = (dir) => {
  const names = readdirSync(dir).filter((n) => n.endsWith('.loro'))
  const bad = names.filter((n) => !verifyUpdate(readFileSync(join(dir, n))))
  return { files: names.length, bad, strays: readdirSync(dir).filter((n) => !n.endsWith('.loro')) }
}

export const flags = (paths) =>
  execFileSync('stat', ['-f', '%Sf', ...paths], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((f) => f.split(',').includes('dataless'))

const brctl = (verb, path) => {
  try {
    execFileSync('brctl', [verb, path], { stdio: 'pipe', encoding: 'utf8' })
    return null
  } catch (err) {
    return (err.stderr || err.message).trim()
  }
}

export const evict = (path) => brctl('evict', path)
export const download = (path) => brctl('download', path)

export const evictAll = async (paths, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  let pending = paths
  let lastError
  while (pending.length && Date.now() < deadline) {
    for (const p of pending) lastError = evict(p) ?? lastError
    await sleep(1000)
    const dataless = flags(pending)
    pending = pending.filter((_, i) => !dataless[i])
  }
  return { evicted: paths.length - pending.length, pending: pending.length, lastError }
}

const expectedSize = (name) => Number(name.match(/-(\d+)\.loro$/)?.[1])

const watchDir = (dir, ms) => {
  const events = []
  const partial = []
  const strays = new Set()
  let polls = 0
  const w = watch(dir, (event, name) => events.push({ t: Date.now(), event, name }))
  const end = Date.now() + ms
  const poll = () => {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.loro')) {
        strays.add(name)
        continue
      }
      try {
        const size = statSync(join(dir, name)).size
        if (size !== expectedSize(name)) partial.push({ name, size })
      } catch {}
    }
    polls++
    if (Date.now() < end) setImmediate(poll)
    else {
      w.close()
      const kinds = {}
      for (const e of events) {
        const k = `${e.event}:${e.name?.endsWith('.crswap') ? '*.crswap' : e.name?.endsWith('.loro') ? '*.loro' : e.name}`
        kinds[k] = (kinds[k] ?? 0) + 1
      }
      console.log(JSON.stringify({ polls, partialSightings: partial.length, partialSample: partial.slice(0, 5), strayNames: [...strays].slice(0, 5), strayCount: strays.size, fsEvents: kinds }))
    }
  }
  poll()
}

if (process.argv[2] === 'watch') watchDir(process.argv[3], Number(process.argv[4]))
