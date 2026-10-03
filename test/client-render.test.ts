/**
 * Rendered-output tests.
 *
 * The contract tests in client.test.ts assert behaviour (what a click does).
 * These assert the visible result: the exact copy, the diff computation, and
 * the states a user actually sees. A regression here is a silently wrong panel
 * rather than a thrown error, which is the failure mode that survives unit
 * tests that only check handlers.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let fetchImpl = async () => { throw new Error('no fetch stub installed') }
globalThis.fetch = (url, init) => fetchImpl(String(url).startsWith('/') ? 'http://localhost' + url : url, init)
globalThis.location = { href: 'http://localhost/' }

/** A minimal React stand-in with real re-rendering; mirrors client.test.ts. */
function makeReact() {
  let current = null
  const react = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      // React puts children in props; components branch on props.children, so a
      // mock that keeps them only on the element cannot render such a component.
      const base = props === null || props === undefined ? {} : { ...props }
      if (flat.length > 0) base.children = flat
      return { type, props: base }
    },
    useState(initial) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) store.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = store.hooks[index]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        store.schedule()
      }]
    },
    useEffect(fn) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) { store.hooks[index] = { ran: true }; store.cleanups.push(fn() ?? (() => {})) }
    },
    useCallback(fn) { current.cursor += 1; return fn },
    useMemo(fn) { current.cursor += 1; return fn() },
    useRef(initial) { const store = current; const index = store.cursor++; if (store.hooks.length <= index) store.hooks[index] = { current: initial }; return store.hooks[index] },
    __expand(node) {
      if (node === null || node === undefined || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map((c) => react.__expand(c)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      if (typeof node.type === 'function') {
        const parent = current
        const saved = parent === null ? 0 : parent.cursor
        const childStore = { hooks: [], cursor: 0, cleanups: [], props: node.props, tree: null, alive: true, schedule() {} }
        current = childStore
        let rendered
        try { rendered = node.type(node.props) } finally { current = parent; if (parent !== null) parent.cursor = saved }
        return react.__expand(rendered)
      }
      const raw = node.props?.children ?? []
      const kids = raw.map((c) => react.__expand(c)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      const nextProps = { ...node.props }
      // An empty children is removed rather than kept as []: a component that
      // branches on `props.children !== undefined` must see undefined when
      // nothing survived expansion, exactly as React leaves it.
      if (kids.length > 0) nextProps.children = kids
      else delete nextProps.children
      return { type: node.type, props: nextProps }
    },
    __mount(component, props) {
      const store = {
        hooks: [], cursor: 0, cleanups: [], props, tree: null, alive: true,
        render() {
          if (!store.alive) return store.tree
          store.cursor = 0
          const previous = current
          current = store
          try { store.tree = react.__expand(component(store.props)) } finally { current = previous }
          return store.tree
        },
        schedule() { if (store.pending) return; store.pending = true; queueMicrotask(() => { store.pending = false; store.render() }) },
      }
      store.render()
      return store
    },
  }
  return react
}

/** Load the bundle against stubs and return the registered components. */
function loadClient(fetchStub) {
  fetchImpl = fetchStub ?? (async () => { throw new Error('no stub') })
  const react = makeReact()
  const registrations = []
  let face = null
  const windowStub = {
    __ModuleLoader__: { load({ id, factory }) { face = factory((s) => { if (s === 'react') return react; throw new Error('unexpected require: ' + s) }); face.__id = id } },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i += 1) a[i] = i + 1; return a } },
  }
  const documentStub = { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }), head: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {}, activeElement: null }
  const scope = { window: windowStub, document: documentStub, location: { href: 'http://localhost/' } }
  new Function('window', 'document', 'globalThis', CLIENT_SOURCE).call(scope, windowStub, documentStub, scope)
  face.apply({ slots: { inject: (k, cb) => cb(), register: (spec, component) => { registrations.push({ spec, component }); return () => {} } } })
  return { react, registrations, face }
}

/** Every text node in a rendered tree, flattened. */
function textOf(node, out = []) {
  // Strings first: a text child is not an object, so the guard below would
  // discard it before the string branch could run.
  if (typeof node === 'string') { out.push(node); return out }
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const c of node) textOf(c, out); return out }
  for (const c of node.props?.children ?? []) textOf(c, out)
  return out
}

const SETTLE = () => new Promise((resolve) => setTimeout(resolve, 20))

/** Standard props for the composer button. */
function buttonProps(draft, overrides = {}) {
  const state = { draft, draftRev: 1, phase: 'plain', attachmentIds: [], occurrences: [], queue: [] }
  return {
    useInput: (selector) => selector(state),
    inputActions: overrides.inputActions ?? { setDraft: () => {}, submit: () => {}, captureInsertion: () => ({ rev: 1 }) },
    session: { id: 's1' },
    locked: overrides.locked ?? false,
  }
}

/**
 * Open the dialog with a canned response.
 *
 * Returns the mounted handle rather than its tree: the mock replaces
 * `instance.tree` on every render, so a snapshot taken here would be stale
 * after any interaction. Read `handle.tree` after each step.
 */
async function openDialog(response, draft = '做个后台') {
  const { react, registrations } = loadClient(async () => ({ ok: true, json: async () => response }))
  const button = registrations.find((r) => r.spec.name === 'conversation.input.right').component
  const mounted = react.__mount(button, buttonProps(draft))
  await mounted.tree.props.onClick()
  await SETTLE()
  const dialog = registrations.find((r) => r.spec.name === 'conversation.input.overlay').component
  return { react, dialog: react.__mount(dialog, {}), registrations }
}

/** A well-formed success payload. */
function payload(overrides = {}) {
  return {
    requestId: 'r1',
    optimized: '# Objective\n\n做一个管理后台。',
    original: '做个后台',
    plan: { domainId: 'ui-design', domainLabel: 'UI / UX / Product Design', complexity: 'moderate', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: ['Objective', 'Requirements'], reasons: ['scope words: 1'] },
    ...overrides,
  }
}

// --- button rendering -----------------------------------------------------

test('the idle button shows the sparkle and the label', () => {
  const { react, registrations } = loadClient()
  const button = registrations.find((r) => r.spec.name === 'conversation.input.right').component
  const text = textOf(react.__mount(button, buttonProps('做个后台')).tree).join('|')
  assert.ok(text.includes('优化提示词'))
})

test('the button label is inside a span that CSS can hide on narrow screens', () => {
  const { react, registrations } = loadClient()
  const button = registrations.find((r) => r.spec.name === 'conversation.input.right').component
  const tree = react.__mount(button, buttonProps('做个后台')).tree
  const label = (tree.props?.children ?? []).find((c) => c?.props?.className === 'dshpo-btnLabel')
  assert.ok(label !== undefined, 'the label span must carry the responsive class')
  assert.equal(label.props.children[0], '优化提示词')
})

// --- dialog rendering -----------------------------------------------------

test('the ready dialog renders the plan chips', async () => {
  const { dialog } = await openDialog(payload())
  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('领域 · UI / UX / Product Design'), text.slice(0, 200))
  assert.ok(text.includes('复杂度 · moderate'))
  assert.ok(text.includes('强度 · balanced'))
  assert.ok(text.includes('语言 · auto'))
  assert.ok(text.includes('Objective · Requirements'), 'the section list must be shown')
})

test('the diff pane is labelled as the original prompt, not the language option', async () => {
  const { dialog } = await openDialog(payload())
  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('原始 Prompt'))
  assert.ok(!text.includes('原文语言'), 'the language option label must not leak into the pane title')
})

test('the dialog always states that it will not send', async () => {
  const { dialog } = await openDialog(payload())
  assert.ok(textOf(dialog.tree).join('|').includes('插件不会自动发送消息'))
})

test('a no-op result is explained rather than presented as a rewrite', async () => {
  const { dialog } = await openDialog(payload({ optimized: '你好', original: '你好', plan: { domainId: 'general', domainLabel: 'General', complexity: 'trivial', intensity: 'balanced', language: 'auto', noop: true, ranked: [], sections: [], reasons: [] } }))
  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('原提示词已经足够清晰'))
  assert.ok(text.includes('已跳过模型调用'))
})

test('an error dialog shows localized copy and the original text', async () => {
  const { dialog } = await openDialog({ requestId: 'r1', code: 'RATE_LIMIT', detail: '429' }, '我的原始需求')
  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('模型服务限流'))
  assert.ok(text.includes('我的原始需求'))
})

test('an unknown error code still produces readable copy', async () => {
  const { dialog } = await openDialog({ requestId: 'r1', code: 'SOMETHING_NEW', detail: 'internal detail' })
  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('提示词优化失败'))
  assert.ok(text.includes('internal detail'), 'the technical detail must remain visible')
})

test('the loading state names what is happening', async () => {
  const { react, registrations } = loadClient(() => new Promise(() => {}))
  const button = registrations.find((r) => r.spec.name === 'conversation.input.right').component
  const mounted = react.__mount(button, buttonProps('做个后台'))
  await mounted.tree.props.onClick()
  const dialog = registrations.find((r) => r.spec.name === 'conversation.input.overlay').component
  const text = textOf(react.__mount(dialog, {}).tree).join('|')
  assert.ok(text.includes('正在分析意图'))
  assert.ok(text.includes('做个后台'), 'the draft stays visible while waiting')
})

// --- diff ----------------------------------------------------------------

/** Collect the view-toggle buttons from a rendered tree, in order. */
function viewToggles(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.props?.className === 'dshpo-segBtn') found.push(node)
    for (const c of node.props?.children ?? []) walk(c)
  }
  walk(tree)
  return found
}

/** Collect the pane titles from a rendered tree, in order. */
function paneTitles(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.props?.className === 'dshpo-paneHead') found.push(textOf(node).join('/'))
    for (const c of node.props?.children ?? []) walk(c)
  }
  walk(tree)
  return found
}

test('the diff view is reachable and shows the change summary', async () => {
  const { dialog } = await openDialog(payload({ original: 'line one\nline two', optimized: 'line one\nline three' }))

  // Side-by-side is the default view.
  assert.deepEqual(paneTitles(dialog.tree).map((t) => t.split('/')[0]), ['原始 Prompt', '优化后的 Prompt'])

  const toggles = viewToggles(dialog.tree)
  assert.equal(toggles.length, 2)
  assert.equal(textOf(toggles[0])[0], '并排')
  assert.equal(textOf(toggles[1])[0], '差异对比')
  assert.equal(toggles[0].props['data-active'], 'true', 'side-by-side starts active')

  toggles[1].props.onClick()
  await SETTLE()

  // The dialog re-renders, so the toggle state is read from the fresh tree.
  const after = viewToggles(dialog.tree)
  assert.equal(after[1].props['data-active'], 'true', 'the diff toggle becomes active')
  assert.equal(paneTitles(dialog.tree)[0].split('/')[0], '差异对比')

  const text = textOf(dialog.tree).join('|')
  assert.ok(text.includes('+1 / -1'), 'the diff must summarize one addition and one removal')
  assert.ok(text.includes('line three'), 'the added line must be present')
  assert.ok(text.includes('line two'), 'the removed line must be present')
})

test('an identical original and optimized produce an empty diff', async () => {
  const { dialog } = await openDialog(payload({ original: 'same', optimized: 'same' }))
  viewToggles(dialog.tree)[1].props.onClick()
  await SETTLE()
  assert.ok(textOf(dialog.tree).join('|').includes('+0 / -0'))
})

// --- settings rendering ---------------------------------------------------

test('every settings row carries a label and a hint', async () => {
  const { react, registrations } = loadClient(async () => ({
    ok: true,
    json: async () => ({
      settings: { model: 'current', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' },
      routes: [{ provider: 'deepseek', models: ['deepseek-chat'] }],
    }),
  }))
  const section = registrations.find((r) => r.spec.name === 'settings.section').component
  const mounted = react.__mount(section, {})
  await SETTLE()
  const text = textOf(mounted.tree).join('|')
  for (const label of ['优化模型', '优化强度', '优化语言', '自动识别领域', '优化后先预览', '参考会话上下文', '参考项目规则', 'Minecraft 专项优化', '视觉上下文', '自定义优化规则']) {
    assert.ok(text.includes(label), 'missing settings label: ' + label)
  }
})

test('the discovered model routes are offered as datalist options', async () => {
  const { react, registrations } = loadClient(async () => ({
    ok: true,
    json: async () => ({
      settings: { model: 'current', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' },
      routes: [{ provider: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] }],
    }),
  }))
  const section = registrations.find((r) => r.spec.name === 'settings.section').component
  const mounted = react.__mount(section, {})
  await SETTLE()
  const options = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'option') options.push(node.props.value)
    for (const c of node.props?.children ?? []) walk(c)
  }
  walk(mounted.tree)
  assert.deepEqual(options.sort(), ['deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'])
})

test('the save button is disabled until something changes', async () => {
  const { react, registrations } = loadClient(async () => ({
    ok: true,
    json: async () => ({
      settings: { model: 'current', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' },
      routes: [],
    }),
  }))
  const section = registrations.find((r) => r.spec.name === 'settings.section').component
  const mounted = react.__mount(section, {})
  await SETTLE()
  const findButton = (label) => {
    let found = null
    const walk = (node) => {
      if (found !== null || node === null || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'button' && node.props?.children?.[0] === label) { found = node; return }
      for (const c of node.props?.children ?? []) walk(c)
    }
    walk(mounted.tree)
    return found
  }
  assert.equal(findButton('保存').props.disabled, true, 'save must start disabled on a clean form')
  assert.equal(findButton('重新读取').props.disabled, false, 'reload is always available')
})
