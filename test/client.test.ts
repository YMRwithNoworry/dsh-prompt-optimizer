/**
 * Client-half tests.
 *
 * The browser bundle is a plain module-loader registration, so it loads in Node
 * against a stub window, a stub React, and a stub fetch. That is enough to
 * assert the guarantees that matter most:
 *
 *   - the button is registered into conversation.input.right;
 *   - it is disabled with an empty draft and enabled with text;
 *   - clicking never calls submit(), send(), or anything agent-facing;
 *   - applying writes the draft and nothing else;
 *   - a stale reply cannot overwrite a newer one;
 *   - every failure path preserves the user's original text.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/**
 * The bundle calls a bare `fetch`, which resolves lexically to the realm's
 * global — an injected globalThis cannot intercept it. So the global is
 * replaced once for the whole test process with a proxy that delegates to a
 * swappable slot. Each loadClient call installs its own stub there; mounting a
 * component later in the test still reaches it.
 */
let fetchImpl = async () => { throw new Error('no fetch stub installed') }
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, init) => fetchImpl(String(url).startsWith('/') ? 'http://localhost' + url : url, init)
globalThis.location = { href: 'http://localhost/' }

/**
 * A minimal but honest React stand-in.
 *
 * Hooks persist per mounted component, so a setState really re-renders. That is
 * what lets a test drive the settings panel through its loading state and the
 * dialog through a request lifecycle.
 */
function makeReact() {
  /** The hook store of the component currently rendering. */
  let current = null

  const react = {
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
      return { type, props: props === null || props === undefined ? {} : props, children: flat }
    },

    useState(initial) {
      const store = current
      const index = store.cursor++
      if (store.hooks.length <= index) {
        store.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const slot = store.hooks[index]
      // The setter closes over its own store: a setState that lands after the
      // render returned still knows which component to re-render.
      const set = (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        store.schedule()
      }
      return [slot.value, set]
    },

    useEffect(fn) {
      const index = current.cursor++
      if (current.hooks.length <= index) {
        current.hooks[index] = { ran: true }
        current.cleanups.push(fn() ?? (() => {}))
      }
    },

    useCallback(fn) { current.cursor += 1; return fn },
    useMemo(fn) { current.cursor += 1; return fn() },

    useRef(initial) {
      const index = current.cursor++
      if (current.hooks.length <= index) current.hooks[index] = { current: initial }
      return current.hooks[index]
    },

    /**
     * Mount a component and return a handle whose \`tree\` reflects the latest
     * render.
     * @param component - the component function.
     * @param props - its props.
     */
    /**
     * Render function components the way React does, so a tree walk sees real
     * elements rather than unresolved component references.
     *
     * Each child gets its own hook store, and the parent's cursor is saved and
     * restored around the child's render — without that, a child's useMemo would
     * advance the parent's cursor and every later hook in the parent would read
     * the wrong slot.
     *
     * @param node - the node to expand.
     */
    __expand(node) {
      if (node === null || node === undefined || typeof node !== 'object') return node
      if (Array.isArray(node)) return node.map((child) => react.__expand(child)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      if (typeof node.type === 'function') {
        const parent = current
        const savedCursor = parent === null ? 0 : parent.cursor
        const childStore = { hooks: [], cursor: 0, cleanups: [], props: node.props, tree: null, alive: true, schedule() {} }
        current = childStore
        let rendered
        try {
          rendered = node.type(node.props)
        } finally {
          current = parent
          if (parent !== null) parent.cursor = savedCursor
        }
        return react.__expand(rendered)
      }
      const expandedChildren = (node.children ?? []).map((child) => react.__expand(child)).flat(Infinity).filter((c) => c !== null && c !== undefined)
      // Preserve an absent children field: a component that branches on
      // `props.children !== undefined` must still see undefined, exactly as React
      // leaves it when no child was passed.
      const next = { ...node }
      if (expandedChildren.length > 0 || Object.prototype.hasOwnProperty.call(node, 'children')) {
        next.children = expandedChildren
      } else {
        delete next.children
      }
      return next
    },

    __mount(component, props) {
      const store = {
        hooks: [],
        cursor: 0,
        cleanups: [],
        props,
        tree: null,
        alive: true,
        render() {
          if (!store.alive) return store.tree
          store.cursor = 0
          const previous = current
          current = store
          try {
            store.tree = react.__expand(component(store.props))
          } finally {
            current = previous
          }
          return store.tree
        },
        // Coalesce the many synchronous setState calls one render can make.
        schedule() {
          if (store.pending) return
          store.pending = true
          queueMicrotask(() => {
            store.pending = false
            store.render()
          })
        },
        unmount() {
          store.alive = false
          for (const cleanup of store.cleanups) if (typeof cleanup === 'function') cleanup()
        },
      }
      store.render()
      return store
    },
  }
  return react
}

/**
 * Load the client bundle against stubs.
 *
 * @param options - fetch stub and React stub.
 * @returns the registered plugin face plus captured slot registrations.
 */
function loadClient(options = {}) {
  const react = options.react ?? makeReact()
  const registrations = []
  const injections = []
  let face = null

  const moduleLoader = {
    load({ id, factory }) {
      face = factory((specifier) => {
        if (specifier === 'react') return react
        throw new Error('unexpected require: ' + specifier)
      })
      face.__id = id
    },
  }

  const windowStub = {
    __ModuleLoader__: moduleLoader,
    crypto: { getRandomValues: (array) => { for (let i = 0; i < array.length; i += 1) array[i] = i + 1; return array } },
  }
  const documentStub = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
  }

  // Install this test's stub into the process-wide slot.
  fetchImpl = options.fetch ?? (async () => { throw new Error('no fetch stub') })

  const globalScope = { window: windowStub, document: documentStub, crypto: windowStub.crypto, location: { href: 'http://localhost/' } }
  const run = new Function('window', 'document', 'globalThis', CLIENT_SOURCE + '\n//# sourceURL=dsh-prompt-optimizer-client.js')
  run.call(globalScope, windowStub, documentStub, globalScope)

  const ctx = {
    slots: {
      inject(key, callback) { injections.push(key); callback() },
      register(spec, component) { registrations.push({ spec, component }); return () => {} },
    },
  }
  face.apply(ctx)
  lastFace = face
  return { face, registrations, injections, react }
}

/** Depth-first search for the first node whose props satisfy a predicate. */
function findNode(node, predicate) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (node.props !== undefined && predicate(node)) return node
  for (const child of node.children ?? []) {
    const found = findNode(child, predicate)
    if (found !== null) return found
  }
  return null
}

/** Collect every node matching a predicate. */
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out }
  if (node.props !== undefined && predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

/** Build the standard props a session-scoped slot occupant receives. */
function slotProps(overrides = {}) {
  const draft = overrides.draft ?? ''
  const state = { draft, draftRev: overrides.draftRev ?? 1, phase: overrides.phase ?? 'plain', attachmentIds: [], occurrences: [], queue: [] }
  return {
    useInput: (selector) => selector(state),
    inputActions: overrides.inputActions ?? { setDraft: () => {}, submit: () => {}, captureInsertion: () => ({ from: 0, to: 0, rev: state.draftRev }) },
    session: overrides.session ?? { id: 's1' },
    locked: overrides.locked ?? false,
    ...overrides.props,
  }
}

/** Let queued microtasks (state updates, fetch promises) settle. */
function settle() { return new Promise((resolve) => setTimeout(resolve, 20)) }

/**
 * The dialog store is module-scoped and therefore shared by every loadClient in
 * this process, exactly as it is shared across the real composer. Each test
 * starts from a clean store so one test's open dialog cannot leak into the next.
 */
let lastFace = null
beforeEach(() => { if (lastFace !== null && typeof lastFace.resetState === 'function') lastFace.resetState() })

/** Look up a registered slot component by slot name. */
function componentOf(registrations, slotName) {
  const entry = registrations.find((r) => r.spec.name === slotName)
  assert.ok(entry !== undefined, 'no registration for ' + slotName)
  return entry.component
}

// --- registration ---------------------------------------------------------

test('the client registers as a module-loader plugin', () => {
  const { face } = loadClient()
  assert.equal(face.__id, 'dsh-prompt-optimizer')
  assert.equal(face.name, 'prompt-optimizer')
  assert.deepEqual(face.inject, ['slots'])
  assert.equal(typeof face.apply, 'function')
})

test('the button occupies conversation.input.right', () => {
  const { registrations, injections } = loadClient()
  assert.ok(injections.includes('conversation.input.right'))
  const entry = registrations.find((r) => r.spec.name === 'conversation.input.right')
  assert.ok(entry !== undefined)
  assert.equal(entry.spec.id, 'prompt-optimizer')
})

test('the dialog occupies conversation.input.overlay', () => {
  const { registrations } = loadClient()
  assert.ok(registrations.some((r) => r.spec.name === 'conversation.input.overlay'))
})

test('a settings section is registered', () => {
  const { registrations } = loadClient()
  const entry = registrations.find((r) => r.spec.name === 'settings.section')
  assert.ok(entry !== undefined)
  assert.equal(entry.spec.label(), '提示词优化器')
})

test('no slot outside the documented three is touched', () => {
  const { registrations } = loadClient()
  const names = registrations.map((r) => r.spec.name).sort()
  assert.deepEqual(names, ['conversation.input.overlay', 'conversation.input.right', 'settings.section'])
})

test('the client bundle never injects into the composer DOM', () => {
  // Check executable code, not the prose that documents the prohibition.
  const code = CLIENT_SOURCE.split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  for (const forbidden of ['MutationObserver', 'getElementById', 'insertBefore', 'closest(']) {
    assert.ok(!code.includes(forbidden), 'client must not use ' + forbidden)
  }
  // querySelector is allowed exactly once, for the idempotent style-tag guard.
  const selectorUses = code.match(/querySelector\(/g) ?? []
  assert.equal(selectorUses.length, 1)
  assert.ok(code.includes('document.querySelector("style[data-plugin-css="'))
  // The only node the bundle ever creates is its own style tag.
  const created = [...code.matchAll(/createElement\("([^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(created)], ['style'])
})

test('the client bundle never calls a submission API', () => {
  for (const forbidden of ['inputActions.submit', '.submit()', 'agent.followup', 'agent.steer', 'remote.session.send']) {
    assert.ok(!CLIENT_SOURCE.includes(forbidden), 'client must not call ' + forbidden)
  }
})

test('the client bundle writes the draft through setDraft only', () => {
  // One real call, plus one mention in the comment that documents it.
  const calls = CLIENT_SOURCE.match(/\.setDraft\(/g) ?? []
  assert.equal(calls.length, 2)
  assert.ok(CLIENT_SOURCE.includes('state.inputActions.setDraft(state.result.optimized)'))
})

test('the client bundle only requires react, a platform seed module', () => {
  const requires = [...CLIENT_SOURCE.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'])
})

// --- button states --------------------------------------------------------

test('the button is disabled with an empty draft', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '' })).tree
  assert.equal(findNode(tree, (n) => n.type === 'button').props.disabled, true)
})

test('the button is disabled with whitespace only', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '   \n  ' })).tree
  assert.equal(findNode(tree, (n) => n.type === 'button').props.disabled, true)
})

test('the button is enabled with text', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '帮我做个后台' })).tree
  assert.equal(findNode(tree, (n) => n.type === 'button').props.disabled, false)
})

test('the button is disabled while the composer is locked', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text', locked: true })).tree
  assert.equal(findNode(tree, (n) => n.type === 'button').props.disabled, true)
})

test('the button is disabled while a submission is in flight', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text', phase: 'submitting' })).tree
  assert.equal(findNode(tree, (n) => n.type === 'button').props.disabled, true)
})

test('the button exposes an accessible label and a tooltip', () => {
  const { registrations, react } = loadClient()
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text' })).tree
  const el = findNode(tree, (n) => n.type === 'button')
  assert.equal(el.props['aria-label'], '使用 AI 优化当前提示词')
  assert.equal(el.props.title, '使用 AI 优化当前提示词')
  assert.equal(el.props.type, 'button')
})

// --- clicking never sends -------------------------------------------------

test('clicking with an empty draft issues no request and calls no action', async () => {
  let calls = 0
  const inputActions = {
    setDraft: () => { calls += 1 },
    submit: () => { calls += 1 },
    captureInsertion: () => ({ from: 0, to: 0, rev: 1 }),
  }
  const { registrations, react } = loadClient({ fetch: async () => { calls += 1; return { ok: true, json: async () => ({}) } } })
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '', inputActions })).tree
  await findNode(tree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.equal(calls, 0)
})

test('clicking with text issues exactly one optimize request', async () => {
  const requests = []
  const fetchStub = async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => ({ requestId: 'x', optimized: 'OPT', original: 'orig', plan: { domainId: 'general', domainLabel: 'General', complexity: 'simple', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: [], reasons: [] } }) }
  }
  const { registrations, react } = loadClient({ fetch: fetchStub })
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '帮我做个后台' })).tree
  await findNode(tree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.equal(requests.length, 1)
  assert.ok(requests[0].url.endsWith('/prompt-optimizer/optimize'))
  const body = JSON.parse(requests[0].options.body)
  assert.equal(body.text, '帮我做个后台')
  assert.equal(typeof body.requestId, 'string')
})

test('clicking never calls submit, even with text', async () => {
  let submitted = false
  const inputActions = {
    setDraft: () => {},
    submit: () => { submitted = true },
    captureInsertion: () => ({ from: 0, to: 0, rev: 1 }),
  }
  const { registrations, react } = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ requestId: 'x', code: 'EMPTY_OUTPUT', detail: 'no text' }) }),
  })
  const tree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text', inputActions })).tree
  await findNode(tree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.equal(submitted, false)
})

test('applying writes the draft and still never submits', async () => {
  const writes = []
  let submitted = false
  const inputActions = {
    setDraft: (text) => { writes.push(text) },
    submit: () => { submitted = true },
    captureInsertion: () => ({ from: 0, to: 0, rev: 1 }),
  }
  const optimized = '# Objective\n\n做一个管理后台。'
  const { registrations, react } = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ requestId: 'x', optimized, original: 'orig', plan: { domainId: 'ui-design', domainLabel: 'UI', complexity: 'simple', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: [], reasons: [] } }) }),
  })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '做个后台', inputActions })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()

  const dialogTree = react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree
  const applyButton = findNode(dialogTree, (n) => n.type === 'button' && n.props['data-variant'] === 'primary')
  assert.ok(applyButton !== null)
  applyButton.props.onClick()
  assert.deepEqual(writes, [optimized])
  assert.equal(submitted, false)
})

test('the dialog offers cancel, regenerate, and apply', async () => {
  const { registrations, react } = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ requestId: 'x', optimized: 'OPT', original: 'o', plan: { domainId: 'general', domainLabel: 'General', complexity: 'simple', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: [], reasons: [] } }) }),
  })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  const labels = findAll(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree, (n) => n.type === 'button')
    .map((n) => String(n.children[0] ?? ''))
  assert.ok(labels.includes('取消'))
  assert.ok(labels.includes('重新优化'))
  assert.ok(labels.includes('采用优化结果'))
})

test('the dialog shows both panes and the diff toggle', async () => {
  const { registrations, react } = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ requestId: 'x', optimized: '# Objective', original: '做个后台', plan: { domainId: 'general', domainLabel: 'General', complexity: 'simple', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: [], reasons: [] } }) }),
  })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '做个后台' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  const text = JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree)
  assert.ok(text.includes('原始 Prompt'))
  assert.ok(text.includes('优化后的 Prompt'))
  assert.ok(text.includes('差异对比'))
  assert.ok(text.includes('插件不会自动发送消息'))
})

// --- failure handling -----------------------------------------------------

test('a failure shows an error and preserves the original text', async () => {
  const { registrations, react } = loadClient({
    fetch: async () => ({ ok: true, json: async () => ({ requestId: 'x', code: 'NO_ROUTE', detail: 'no route' }) }),
  })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: '原始文本' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  const text = JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree)
  assert.ok(text.includes('找不到可用的模型路由'))
  assert.ok(text.includes('原始文本'))
})

test('a network failure is reported, not thrown', async () => {
  const { registrations, react } = loadClient({ fetch: async () => { throw new Error('offline') } })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.ok(JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree).includes('网络错误'))
})

test('an HTTP error status is reported', async () => {
  const { registrations, react } = loadClient({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.ok(JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree).includes('网络错误'))
})

// --- race protection ------------------------------------------------------

test('a stale reply cannot overwrite a newer request', async () => {
  const pending = []
  const fetchStub = (url, options) => {
    const body = JSON.parse(options.body)
    return new Promise((resolve) => {
      pending.push({ text: body.text, resolve: () => resolve({
        ok: true,
        json: async () => ({ requestId: body.requestId, optimized: 'RESULT-' + body.text, original: body.text, plan: { domainId: 'general', domainLabel: 'General', complexity: 'simple', intensity: 'balanced', language: 'auto', noop: false, ranked: [], sections: [], reasons: [] } }),
      }) })
    })
  }
  const { registrations, react } = loadClient({ fetch: fetchStub })

  const first = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'first' })).tree
  await findNode(first, (n) => n.type === 'button').props.onClick()
  await settle()
  const second = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'second' })).tree
  await findNode(second, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.equal(pending.length, 2, 'both requests must be in flight')

  // Settle the FIRST request last; its reply must be dropped.
  pending[0].resolve()
  await settle()
  pending[1].resolve()
  await settle()

  const text = JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree)
  assert.ok(text.includes('RESULT-second'))
  assert.ok(!text.includes('RESULT-first'))
})

// --- settings section -----------------------------------------------------

/** The settings payload the panel loads. */
const SETTINGS_PAYLOAD = {
  settings: { model: 'current', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' },
  routes: [{ provider: 'deepseek', models: ['deepseek-chat'] }],
}

test('the settings section renders every documented control', async () => {
  const { registrations, react } = loadClient({ fetch: async () => ({ ok: true, json: async () => SETTINGS_PAYLOAD }) })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  const tree = mounted.tree
  assert.equal(findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 6)
  assert.equal(findAll(tree, (n) => n.type === 'textarea').length, 1)
  assert.equal(findAll(tree, (n) => n.type === 'input' && n.props.list === 'dshpo-routes').length, 1)
  assert.equal(findAll(tree, (n) => n.type === 'datalist').length, 1)
})

test('the settings section offers all three intensities and four languages', async () => {
  const { registrations, react } = loadClient({ fetch: async () => ({ ok: true, json: async () => SETTINGS_PAYLOAD }) })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  const labels = findAll(mounted.tree, (n) => n.type === 'button').map((n) => String(n.children[0] ?? ''))
  for (const label of ['Light', 'Balanced', 'Deep', 'Auto', '中文', 'English', '原文语言']) {
    assert.ok(labels.includes(label), 'missing option: ' + label)
  }
})

test('the settings panel reports a load failure instead of crashing', async () => {
  const { registrations, react } = loadClient({ fetch: async () => { throw new Error('boom') } })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  assert.ok(JSON.stringify(mounted.tree).includes('读取失败'))
})

test('the settings panel shows the loading state before the fetch settles', () => {
  const { registrations, react } = loadClient({ fetch: () => new Promise(() => {}) })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  assert.ok(JSON.stringify(mounted.tree).includes('加载中'))
})

test('the settings panel saves and reports success', async () => {
  const posts = []
  const { registrations, react } = loadClient({
    fetch: async (url, options) => {
      if (options !== undefined && options.method === 'POST') {
        posts.push(JSON.parse(options.body))
        return { ok: true, json: async () => ({ ok: true, settings: JSON.parse(options.body).settings, routes: [] }) }
      }
      return { ok: true, json: async () => SETTINGS_PAYLOAD }
    },
  })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  // Toggle a switch, then save.
  const checkbox = findAll(mounted.tree, (n) => n.type === 'input' && n.props.type === 'checkbox')[0]
  checkbox.props.onChange({ target: { checked: false } })
  await settle()
  const saveButton = findAll(mounted.tree, (n) => n.type === 'button' && n.children[0] === '保存')[0]
  assert.ok(saveButton !== undefined, 'save button must exist')
  assert.equal(saveButton.props.disabled, false, 'save must enable once dirty')
  saveButton.props.onClick()
  await settle()
  assert.equal(posts.length, 1)
  assert.equal(posts[0].settings.autoDetectDomain, false)
})
