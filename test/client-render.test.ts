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
import {
  componentOf,
  findAll,
  findNode,
  loadClient,
  settle as SETTLE,
  textOf,
} from './helpers/react-stub.ts'

/** Mount the composer button with the standard session props. */
function buttonProps(draft, overrides = {}) {
  const state = { draft, draftRev: 1, phase: "plain", attachmentIds: [], occurrences: [], queue: [] }
  return {
    useInput: (selector) => selector(state),
    inputActions: overrides.inputActions ?? { setDraft: () => {}, submit: () => {}, captureInsertion: () => ({ rev: 1 }) },
    session: { id: "s1" },
    locked: overrides.locked ?? false,
  }
}

/**
 * Open the dialog with a canned response.
 *
 * Returns the mounted handle rather than its tree: the stub replaces
 * `handle.tree` on every render, so a snapshot taken here would be stale
 * after any interaction. Read `handle.tree` after each step.
 */
async function openDialog(response, draft = "做个后台") {
  const { react, registrations } = loadClient({ fetch: async () => ({ ok: true, json: async () => response }) })
  const button = componentOf(registrations, "conversation.input.right")
  const mounted = react.__mount(button, buttonProps(draft))
  await mounted.tree.props.onClick()
  await SETTLE()
  const dialog = componentOf(registrations, "conversation.input.overlay")
  return { react, dialog: react.__mount(dialog, {}), registrations }
}

/** A well-formed success payload. */
function payload(overrides = {}) {
  return {
    requestId: "r1",
    optimized: "# Objective\n\n做一个管理后台。",
    original: "做个后台",
    plan: { domainId: "ui-design", domainLabel: "UI / UX / Product Design", complexity: "moderate", intensity: "balanced", language: "auto", noop: false, ranked: [], sections: ["Objective", "Requirements"], reasons: ["scope words: 1"] },
    ...overrides,
  }
}

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
  const { react, registrations } = loadClient({ fetch: () => new Promise(() => {}) })
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

/** Base settings for the settings-panel tests. */
const BASE = { model: 'current', reasoningEffort: '', intensity: 'balanced', language: 'auto', autoDetectDomain: true, showPreview: true, useConversationContext: true, useProjectContext: true, minecraftOptimization: true, enableVisionContext: true, customInstructions: '' }

/** Two models, only one of which advertises reasoning efforts. */
const ROUTES_PAYLOAD = {
  settings: BASE,
  routes: [
    { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-chat', modelName: 'DeepSeek Chat', value: 'deepseek/deepseek-chat', efforts: [] },
    { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-reasoner', modelName: 'DeepSeek Reasoner', value: 'deepseek/deepseek-reasoner', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
  ],
}

/**
 * Mount the settings section with a given payload.
 *
 * @param payload - the settings document the host would return.
 * @param onSave - receives the POSTed body when the panel saves.
 */
async function mountSettings(payload, onSave) {
  const { react, registrations } = loadClient({
    fetch: async (url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body)
        if (onSave !== undefined) onSave(body)
        return { ok: true, json: async () => ({ ok: true, ...payload, settings: body.settings }) }
      }
      return { ok: true, json: async () => payload }
    },
  })
  const mounted = react.__mount(componentOf(registrations, 'settings.section'), {})
  await SETTLE()
  return mounted
}

/** Every select in the rendered tree, in document order. */
function selectsOf(mounted) {
  return findAll(mounted.tree, (node) => node.type === 'select')
}

/** Option values of the nth select, or null when it does not exist. */
function optionValues(mounted, index) {
  const select = selectsOf(mounted)[index]
  if (select === undefined) return null
  return findAll(select, (node) => node.type === 'option').map((node) => node.props.value)
}

/** Click a settings button by its label. */
function clickButton(mounted, label) {
  const button = findNode(mounted.tree, (node) => node.type === 'button' && node.props?.children?.[0] === label)
  assert.ok(button !== null, 'no button labelled ' + label)
  button.props.onClick()
}

test('every settings row carries a label and a hint', async () => {
  const mounted = await mountSettings(ROUTES_PAYLOAD)
  const text = textOf(mounted.tree).join('|')
  const labels = ['优化模型', '优化强度', '优化语言', '自动识别领域', '优化后先预览', '参考会话上下文', '参考项目规则', 'Minecraft 专项优化', '视觉上下文', '自定义优化规则']
  for (const label of labels) assert.ok(text.includes(label), 'missing settings label: ' + label)
})

test('the model control offers current plus every discovered route', async () => {
  const mounted = await mountSettings(ROUTES_PAYLOAD)
  assert.deepEqual(optionValues(mounted, 0), ['current', 'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'])
})

test('the model option labels name the provider and the model', async () => {
  const mounted = await mountSettings(ROUTES_PAYLOAD)
  const labels = JSON.stringify(mounted.tree)
  assert.ok(labels.includes('DeepSeek · DeepSeek Chat'))
  assert.ok(labels.includes('DeepSeek · DeepSeek Reasoner'))
})

test('a route whose model id differs from its name shows both', async () => {
  const mounted = await mountSettings({
    settings: BASE,
    routes: [{ provider: 'op', providerName: 'OpenAI', model: 'gpt-x-2026', modelName: 'GPT-X', value: 'op/gpt-x-2026', efforts: [] }],
  })
  assert.ok(JSON.stringify(mounted.tree).includes('OpenAI · GPT-X (gpt-x-2026)'))
})

test('a hand-written route outside the catalog stays selectable', async () => {
  const mounted = await mountSettings({ settings: { ...BASE, model: 'custom/not-listed' }, routes: ROUTES_PAYLOAD.routes })
  assert.ok(optionValues(mounted, 0).includes('custom/not-listed'), 'the stored value must not be dropped')
  assert.ok(JSON.stringify(mounted.tree).includes('自定义路由'))
})

test('no effort control appears for a route that advertises none', async () => {
  const mounted = await mountSettings({ settings: { ...BASE, model: 'deepseek/deepseek-chat' }, routes: ROUTES_PAYLOAD.routes })
  assert.equal(optionValues(mounted, 1), null, 'only the model select must exist')
})

test('the effort control appears for a route that advertises efforts', async () => {
  const mounted = await mountSettings({ settings: { ...BASE, model: 'deepseek/deepseek-reasoner' }, routes: ROUTES_PAYLOAD.routes })
  assert.deepEqual(optionValues(mounted, 1), ['', 'low', 'high'])
})

test('the effort control names the route default instead of showing an id', async () => {
  const mounted = await mountSettings({ settings: { ...BASE, model: 'deepseek/deepseek-reasoner' }, routes: ROUTES_PAYLOAD.routes })
  assert.ok(textOf(mounted.tree).join('|').includes('默认（High）'))
})

test('changing to a route without efforts clears the stale effort', async () => {
  let saved = null
  const mounted = await mountSettings(
    { settings: { ...BASE, model: 'deepseek/deepseek-reasoner', reasoningEffort: 'low' }, routes: ROUTES_PAYLOAD.routes },
    (body) => { saved = body },
  )
  selectsOf(mounted)[0].props.onChange({ target: { value: 'deepseek/deepseek-chat' } })
  await SETTLE()
  clickButton(mounted, '保存')
  await SETTLE()
  assert.equal(saved.settings.model, 'deepseek/deepseek-chat')
  assert.equal(saved.settings.reasoningEffort, '', 'an effort the new route lacks must be cleared')
})

test('an effort both routes offer survives a route change', async () => {
  let saved = null
  const routes = [...ROUTES_PAYLOAD.routes, { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-r2', modelName: 'R2', value: 'deepseek/deepseek-r2', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }]
  const mounted = await mountSettings(
    { settings: { ...BASE, model: 'deepseek/deepseek-reasoner', reasoningEffort: 'low' }, routes },
    (body) => { saved = body },
  )
  selectsOf(mounted)[0].props.onChange({ target: { value: 'deepseek/deepseek-r2' } })
  await SETTLE()
  clickButton(mounted, '保存')
  await SETTLE()
  assert.equal(saved.settings.reasoningEffort, 'low', 'a shared effort must be kept')
})

test('choosing an effort persists it', async () => {
  let saved = null
  const mounted = await mountSettings(
    { settings: { ...BASE, model: 'deepseek/deepseek-reasoner' }, routes: ROUTES_PAYLOAD.routes },
    (body) => { saved = body },
  )
  selectsOf(mounted)[1].props.onChange({ target: { value: 'high' } })
  await SETTLE()
  clickButton(mounted, '保存')
  await SETTLE()
  assert.equal(saved.settings.reasoningEffort, 'high')
})

test('an empty route list still renders a usable panel', async () => {
  const mounted = await mountSettings({ settings: BASE, routes: [] })
  assert.deepEqual(optionValues(mounted, 0), ['current'])
  assert.ok(textOf(mounted.tree).join('|').includes('未发现可用的模型路由'))
})

test('the model and effort controls carry accessible labels', async () => {
  const mounted = await mountSettings({ settings: { ...BASE, model: 'deepseek/deepseek-reasoner' }, routes: ROUTES_PAYLOAD.routes })
  const selects = selectsOf(mounted)
  assert.equal(selects[0].props['aria-label'], '优化模型')
  assert.equal(selects[1].props['aria-label'], '思考强度')
})
