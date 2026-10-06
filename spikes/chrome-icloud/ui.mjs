export const connectUi = async (port) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/0`)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => ws.close() }
}

const walk = (node, fn) => {
  fn(node)
  for (const child of node.children ?? []) walk(child, fn)
}

const attr = (node, key) => {
  const a = node.attributes ?? []
  return a[a.indexOf(key) + 1]
}

const property = async (ui, nodeId, name) => {
  const { result } = await ui.send('CSS.getMatchedStylesForNode', { nodeId })
  for (const rule of result?.matchedCSSRules ?? []) for (const p of rule.rule.style.cssProperties) if (p.name === name) return p.value
}

export const dialogs = async (ui) => {
  await ui.send('DOM.enable')
  await ui.send('CSS.enable')
  const { root } = (await ui.send('DOM.getDocument')).result
  const out = []
  for (const widget of root.children ?? []) {
    const nodes = []
    walk(widget, (n) => nodes.push(n))
    if (nodes.length > 400) continue
    const items = []
    for (const n of nodes) {
      const cls = attr(n, 'class') ?? n.nodeName
      if (!/Label|Button|Checkbox|Radio/.test(cls)) continue
      const text = await property(ui, n.nodeId, 'Text')
      items.push({ nodeId: n.nodeId, cls, text })
    }
    out.push({ widget: attr(widget, 'name') ?? widget.nodeName, nodes: nodes.length, items: items.filter((i) => i.text || /Button/.test(i.cls)) })
  }
  return out
}

export const click = async (ui, nodeId) => {
  for (const type of ['mousePressed', 'mouseReleased'])
    await ui.send('DOM.dispatchMouseEvent', { nodeId, event: { type, x: 5, y: 5, button: 'left', wheelDirection: 'none' } })
}
