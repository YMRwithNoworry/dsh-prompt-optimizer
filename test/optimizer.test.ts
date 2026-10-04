/**
 * Optimizer tests: planning, no-op decisions, output cleaning, and the full
 * call path against a stub LLM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeModelOutput, optimize, planOptimization, shouldNoop } from '../src/optimizer/optimizer.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'
import { OptimizeError } from '../src/optimizer/provider.ts'

/** Build a context whose `llm.stream` yields a canned assistant message. */
function stubContext(chunks, options = {}) {
  return {
    llm: {
      async *stream() {
        if (options.throw !== undefined) throw options.throw
        for (const chunk of chunks) yield chunk
      },
    },
    ...(options.agentDefaultModel === undefined ? {} : { agentDefaultModel: options.agentDefaultModel }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  }
}

/**
 * A minimal text-only stream, in the exact shape `ctx.llm.stream` yields:
 * block-start / text-delta / block-end / finish.
 */
function textStream(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const settings = { ...DEFAULT_SETTINGS, model: 'p/m' }

test('planOptimization is pure and detects domain + complexity', () => {
  const plan = planOptimization({ text: '帮我做个好看的管理后台', settings })
  assert.equal(plan.domain.domain.id, 'ui-design')
  assert.equal(plan.intensity, 'balanced')
  assert.equal(plan.language, 'auto')
})

test('a greeting plans as a no-op', () => {
  const plan = planOptimization({ text: '你好', settings })
  assert.equal(plan.noop, true)
  assert.equal(plan.complexity.level, 'trivial')
})

test('an empty draft is a no-op', () => {
  assert.equal(planOptimization({ text: '   ', settings }).noop, true)
})

test('a real request is not a no-op', () => {
  assert.equal(planOptimization({ text: '帮我做个好看的管理后台', settings }).noop, false)
})

test('light intensity no-ops on a very short simple draft', () => {
  const verdict = { level: 'simple', reasons: [], budget: 600 }
  assert.equal(shouldNoop('好的呀', verdict, 'light'), true)
  assert.equal(shouldNoop('好的呀', verdict, 'balanced'), false)
})

test('autoDetectDomain:false forces the general strategy', () => {
  const plan = planOptimization({
    text: 'minecraft mod 开发',
    settings: { ...settings, autoDetectDomain: false },
  })
  assert.equal(plan.domain.domain.id, 'general')
})

test('per-call intensity overrides the stored setting', () => {
  const plan = planOptimization({ text: '帮我做个好看的管理后台', settings, intensity: 'deep' })
  assert.equal(plan.intensity, 'deep')
})

test('complex tasks earn acceptance criteria', () => {
  const plan = planOptimization({
    text: '做一个完整的桌面应用，支持账号、同步、主题和插件系统，需要端到端架构以及完整的数据迁移方案。',
    settings,
  })
  assert.ok(plan.sections.includes('Acceptance Criteria'))
})

test('trivial tasks earn no sections', () => {
  const plan = planOptimization({ text: '你好', settings })
  assert.deepEqual(plan.sections, [])
})

test('a no-op never calls the model', async () => {
  let called = false
  const ctx = {
    llm: { async *stream() { called = true; yield { type: 'finish', reason: { kind: 'stop' } } } },
  }
  const outcome = await optimize(ctx, { text: '谢谢', settings })
  assert.equal(outcome.skipped, true)
  assert.equal(called, false)
  assert.equal(outcome.optimized, '谢谢')
})

test('optimize returns the model text and echoes the original', async () => {
  const ctx = stubContext(textStream('# Objective\n\n做一个管理后台。'))
  const outcome = await optimize(ctx, { text: '做个后台', settings })
  assert.equal(outcome.optimized, '# Objective\n\n做一个管理后台。')
  assert.equal(outcome.original, '做个后台')
  assert.equal(outcome.skipped, false)
  assert.deepEqual(outcome.route, { provider: 'p', model: 'm' })
})

test('an explicit provider/model route is used when configured', async () => {
  let seen = null
  const ctx = {
    llm: {
      async *stream(options) { seen = options; for (const c of textStream('x')) yield c },
    },
  }
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'openai/gpt-x' } })
  assert.equal(seen.provider, 'openai')
  assert.equal(seen.model, 'gpt-x')
})

test('the session route is used when the setting is current', async () => {
  let seen = null
  const ctx = { llm: { async *stream(o) { seen = o; for (const c of textStream('x')) yield c } } }
  await optimize(ctx, {
    text: '做个后台',
    settings: { ...settings, model: 'current' },
    sessionRoute: { provider: 'sess', model: 'sess-model' },
  })
  assert.equal(seen.provider, 'sess')
})

test('the harness default model is the last resort', async () => {
  let seen = null
  const ctx = {
    llm: { async *stream(o) { seen = o; for (const c of textStream('x')) yield c } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'def', model: 'def-model' }) },
  }
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'current' } })
  assert.equal(seen.provider, 'def')
})

test('no resolvable route raises NO_ROUTE', async () => {
  const ctx = { llm: { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } } } }
  await assert.rejects(
    () => optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'current' } }),
    (error) => error instanceof OptimizeError && error.code === 'NO_ROUTE',
  )
})

test('a provider failure surfaces its code', async () => {
  const failure = Object.assign(new Error('boom'), { code: 'AUTH' })
  const ctx = stubContext([], { throw: failure })
  await assert.rejects(
    () => optimize(ctx, { text: '做个后台', settings }),
    (error) => error instanceof OptimizeError && error.code === 'AUTH',
  )
})

test('empty model output raises EMPTY_OUTPUT', async () => {
  const ctx = stubContext([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  await assert.rejects(
    () => optimize(ctx, { text: '做个后台', settings }),
    (error) => error instanceof OptimizeError && error.code === 'EMPTY_OUTPUT',
  )
})

test('an aborted signal reports ABORTED', async () => {
  const controller = new AbortController()
  controller.abort()
  const ctx = stubContext([], { throw: Object.assign(new Error('aborted'), { name: 'AbortError' }) })
  await assert.rejects(
    () => optimize(ctx, { text: '做个后台', settings, signal: controller.signal }),
    (error) => error instanceof OptimizeError && error.code === 'ABORTED',
  )
})

// --- normalizeModelOutput -------------------------------------------------

test('normalize strips a whole-answer code fence', () => {
  assert.equal(normalizeModelOutput('```markdown\n# Objective\n\nX\n```'), '# Objective\n\nX')
})

test('normalize strips a bare code fence', () => {
  assert.equal(normalizeModelOutput('```\nbody\n```'), 'body')
})

test('normalize strips a leading preamble paragraph', () => {
  assert.equal(normalizeModelOutput('Here is the optimized prompt:\n\n# Objective'), '# Objective')
  assert.equal(normalizeModelOutput('好的，以下是优化结果：\n\n# Objective'), '# Objective')
})

test('normalize leaves a clean prompt untouched', () => {
  const clean = '# Objective\n\n做一个管理后台。'
  assert.equal(normalizeModelOutput(clean), clean)
})

test('normalize does not eat content that merely starts with a keyword', () => {
  const text = '好的设计需要清晰的层级。'
  assert.equal(normalizeModelOutput(text), text)
})

test('normalize trims surrounding whitespace', () => {
  assert.equal(normalizeModelOutput('\n\n  body  \n\n'), 'body')
})

// --- reasoning effort -----------------------------------------------------

/** Capture the options handed to `llm.stream`. */
function capturingContext() {
  const seen = {}
  return {
    seen,
    ctx: {
      llm: {
        async *stream(options) {
          Object.assign(seen, options)
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'out' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'out' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    },
  }
}

test('no effort is forwarded when the setting is empty', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: '' } })
  assert.equal('reasoningEffort' in seen, false, 'an empty effort must not reach the adapter')
})

test('a chosen effort is forwarded to the provider', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: 'high' } })
  assert.equal(seen.reasoningEffort, 'high')
})

test('whitespace around an effort is trimmed', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: '  low  ' } })
  assert.equal(seen.reasoningEffort, 'low')
})

test('the effort does not leak into the request body as an empty field', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: '   ' } })
  assert.equal('reasoningEffort' in seen, false)
})

test('an explicit route uses its own effort, not the session\'s', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, {
    text: '做个后台',
    settings: { ...settings, model: 'p/m', reasoningEffort: 'high' },
    sessionRoute: { provider: 's', model: 'sm', reasoningEffort: 'low' },
  })
  assert.equal(seen.provider, 'p')
  assert.equal(seen.reasoningEffort, 'high', 'the pinned route owns its effort')
})

test('following the session also follows its effort', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, {
    text: '做个后台',
    settings: { ...settings, model: 'current', reasoningEffort: '' },
    sessionRoute: { provider: 's', model: 'sm', reasoningEffort: 'medium' },
  })
  assert.equal(seen.provider, 's')
  assert.equal(seen.reasoningEffort, 'medium')
})

test('a per-call setting effort overrides the session effort', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, {
    text: '做个后台',
    settings: { ...settings, model: 'current', reasoningEffort: 'high' },
    sessionRoute: { provider: 's', model: 'sm', reasoningEffort: 'low' },
  })
  assert.equal(seen.reasoningEffort, 'high')
})


// --- request shape --------------------------------------------------------

test('the request carries no sampling temperature', async () => {
  // Reasoning models reject a sampling temperature, and every model that
  // declares reasoningEfforts is one of them — including the desktop default.
  // The harness's own agent loop and the official session-title provider never
  // send one either, which is the precedent this follows.
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: 'high' } })
  assert.equal('temperature' in seen, false, 'a temperature would make reasoning models fail')
})

test('the request carries only the fields the harness itself sends', async () => {
  const { ctx, seen } = capturingContext()
  await optimize(ctx, { text: '做个后台', settings: { ...settings, model: 'p/m', reasoningEffort: 'high' } })
  assert.deepEqual(Object.keys(seen).sort(), [
    'maxTokens',
    'messages',
    'model',
    'provider',
    'purpose',
    'reasoningEffort',
    'system',
  ])
})

