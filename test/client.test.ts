/**
 * Client-half contract tests.
 *
 * The browser bundle is a plain module-loader registration, so it loads in Node
 * against the shared React stand-in (see `helpers/react-stub.ts`) and a stub
 * fetch. That is enough to assert the guarantees that matter most:
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
import {
  CLIENT_SOURCE,
  componentOf,
  findNode,
  findAll,
  loadClient,
  settle,
  textOf,
} from './helpers/react-stub.ts'

/**
 * The dialog store is module-scoped inside the bundle and therefore shared by
 * every loadClient call in this process, exactly as it is shared across the real
 * composer. Each test starts from a clean store so one test's open dialog cannot
 * leak into the next.
 */
let lastFace = null
beforeEach(() => { if (lastFace !== null && typeof lastFace.resetState === 'function') lastFace.resetState() })

/** Load the bundle and remember its face for the next test's reset. */
function load(options) {
  const loaded = loadClient(options)
  lastFace = loaded.face
  return loaded
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
  const { registrations, react } = load({ fetch: async () => { calls += 1; return { ok: true, json: async () => ({}) } } })
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
  const { registrations, react } = load({ fetch: fetchStub })
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
    .map((n) => String(n.props.children?.[0] ?? ''))
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
  const { registrations, react } = load({ fetch: async () => { throw new Error('offline') } })
  const buttonTree = react.__mount(componentOf(registrations, 'conversation.input.right'), slotProps({ draft: 'text' })).tree
  await findNode(buttonTree, (n) => n.type === 'button').props.onClick()
  await settle()
  assert.ok(JSON.stringify(react.__mount(componentOf(registrations, 'conversation.input.overlay'), {}).tree).includes('网络错误'))
})

test('an HTTP error status is reported', async () => {
  const { registrations, react } = load({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
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
  const { registrations, react } = load({ fetch: fetchStub })

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
  settings: { model: 'current', reasoningEffort: '', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' },
  routes: [{ provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-chat', modelName: 'DeepSeek Chat', value: 'deepseek/deepseek-chat', efforts: [] }],
}

test('the settings section renders every documented control', async () => {
  const { registrations, react } = load({ fetch: async () => ({ ok: true, json: async () => SETTINGS_PAYLOAD }) })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  const tree = mounted.tree
  assert.equal(findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 6)
  assert.equal(findAll(tree, (n) => n.type === 'textarea').length, 1)
  // The model control is a real <select> fed by host discovery, not a
  // free-text input with a datalist.
  assert.ok(findAll(tree, (n) => n.type === 'select').length >= 1)
  assert.ok(findAll(tree, (n) => n.type === 'option').length >= 1)
})

test('the settings section offers all three intensities and four languages', async () => {
  const { registrations, react } = load({ fetch: async () => ({ ok: true, json: async () => SETTINGS_PAYLOAD }) })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  const labels = findAll(mounted.tree, (n) => n.type === 'button').map((n) => String(n.props.children?.[0] ?? ''))
  for (const label of ['Light', 'Balanced', 'Deep', 'Auto', '中文', 'English', '原文语言']) {
    assert.ok(labels.includes(label), 'missing option: ' + label)
  }
})

test('the settings panel reports a load failure instead of crashing', async () => {
  const { registrations, react } = load({ fetch: async () => { throw new Error('boom') } })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await settle()
  assert.ok(JSON.stringify(mounted.tree).includes('读取失败'))
})

test('the settings panel shows the loading state before the fetch settles', () => {
  const { registrations, react } = load({ fetch: () => new Promise(() => {}) })
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
  const saveButton = findAll(mounted.tree, (n) => n.type === 'button' && n.props.children?.[0] === '保存')[0]
  assert.ok(saveButton !== undefined, 'save button must exist')
  assert.equal(saveButton.props.disabled, false, 'save must enable once dirty')
  saveButton.props.onClick()
  await settle()
  assert.equal(posts.length, 1)
  assert.equal(posts[0].settings.autoDetectDomain, false)
})
