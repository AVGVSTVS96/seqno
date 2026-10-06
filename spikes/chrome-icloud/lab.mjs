import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { download, evict, evictAll, flags, genFiles, sleep, verifyDir, writeAtomic } from './outside.mjs'
import { makeUpdate, stats } from './page/content.js'
import { click, connectUi, dialogs } from './ui.mjs'

const here = new URL('.', import.meta.url).pathname
const ROOTS = {
  icloud: process.env.ICLOUD_ROOT ?? `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/seqno-spike/chrome-icloud`,
  local: process.env.LOCAL_ROOT ?? join(here, 'tmp/local-root'),
}
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 8787
const CDP_PORT = 9333
const UI_PORT = 9334
const ORIGIN = `http://127.0.0.1:${PORT}`
const TYPES = { js: 'text/javascript', json: 'application/manifest+json', svg: 'image/svg+xml', html: 'text/html' }

const serve = () =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const file = new URL(req.url, ORIGIN).pathname.slice(1) || 'index.html'
      try {
        const body = readFileSync(join(here, 'page', file))
        res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()] })
        res.end(body)
      } catch {
        res.writeHead(404).end()
      }
    })
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })

const launch = async () => {
  const server = await serve()
  const chrome = spawn(CHROME, [`--user-data-dir=${join(here, 'profile')}`, `--remote-debugging-port=${CDP_PORT}`, `--enable-ui-devtools=${UI_PORT}`, '--no-first-run', '--no-default-browser-check', ORIGIN], { stdio: 'ignore' })
  for (let i = 0; i < 150; i++) {
    if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) break
    await sleep(100)
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
  const context = browser.contexts()[0]
  let page
  while (!(page = context.pages().find((p) => p.url().startsWith(ORIGIN)))) await sleep(100)
  await page.waitForFunction(() => window.lab)
  await page.evaluate(() => window.lab.ready)
  const version = (await browser.version())
  const close = async () => {
    const session = await browser.newBrowserCDPSession()
    await session.send('Browser.close').catch(() => {})
    if (chrome.exitCode === null) await new Promise((r) => chrome.once('exit', r))
    server.close()
  }
  return { page, context, version, close, lab: (fn, arg) => page.evaluate(([f, a]) => window.lab[f](a), [fn, arg]) }
}

const withChrome = async (fn) => {
  const chrome = await launch()
  try {
    return { chrome: chrome.version, ...(await fn(chrome)) }
  } finally {
    await chrome.close()
  }
}

const dropFolder = async (page, key, path) => {
  const cdp = await page.context().newCDPSession(page)
  await page.evaluate((k) => {
    document.body.dataset.dropKey = k
    window.dropResult = null
  }, key)
  const data = { items: [], files: [path], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: 200, y: 300, data })
  await page.waitForFunction(() => window.dropResult, null, { timeout: 10_000 })
  return page.evaluate(() => window.dropResult)
}

const perms = async (lab) => ({ icloud: await lab('perm', 'icloud'), local: await lab('perm', 'local') })

const runId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

const commands = {
  acquire: () =>
    withChrome(async ({ page, lab }) => {
      mkdirSync(ROOTS.local, { recursive: true })
      const dropped = { icloud: await dropFolder(page, 'icloud', ROOTS.icloud), local: await dropFolder(page, 'local', ROOTS.local) }
      return { dropped, perms: await perms(lab) }
    }),

  perm: () => withChrome(async ({ lab }) => ({ perms: await perms(lab) })),

  'pick-intercept': () =>
    withChrome(async ({ page }) => {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Page.enable')
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true })
      const opened = new Promise((r) => cdp.once('Page.fileChooserOpened', r))
      await page.click('#pick')
      const event = await Promise.race([opened, sleep(5000).then(() => 'no fileChooserOpened event')])
      const accept = await cdp.send('DOM.setFileInputFiles', { files: [ROOTS.icloud] }).then(() => 'ok', (e) => e.message)
      const result = await Promise.race([page.evaluate(() => window.pickResult), sleep(5000).then(() => 'pending')])
      return { event, accept, result }
    }),

  grant: (key = 'icloud', answer = 'Allow') =>
    withChrome(async ({ page, lab }) => {
      const before = await lab('perm', key)
      await page.evaluate((k) => {
        document.querySelector('#grant').dataset.key = k
        window.grantResult = null
      }, key)
      await page.click('#grant')
      const prompt = await answerPrompt(answer)
      const result = await Promise.race([page.evaluate(() => window.grantResult), sleep(answer === 'manual' ? 300_000 : 10_000).then(() => 'no answer (timeout)')])
      return { key, before, prompt, result, after: await lab('perm', key) }
    }),
}

const answerPrompt = async (answer) => {
  const ui = await connectUi(UI_PORT)
  try {
    for (let i = 0; i < 25; i++) {
      await sleep(200)
      const prompt = (await dialogs(ui)).find((d) => d.items.some((x) => x.cls === 'MdTextButton'))
      if (!prompt) continue
      const texts = [...new Set(prompt.items.filter((x) => x.text && x.cls !== 'LabelButtonLabel' && x.cls !== 'MdTextButton').map((x) => x.text))]
      const buttons = prompt.items.filter((x) => x.cls === 'MdTextButton')
      const target = buttons.find((b) => b.text === answer)
      if (target) await click(ui, target.nodeId)
      return { texts, buttons: buttons.map((b) => b.text), clicked: target?.text ?? null }
    }
    return null
  } finally {
    ui.close()
  }
}

const [cmd, ...args] = process.argv.slice(2)
if (!commands[cmd]) {
  console.error(`usage: node lab.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(1)
}
console.log(JSON.stringify({ cmd, args, ...(await commands[cmd](...args)) }, null, 1))
