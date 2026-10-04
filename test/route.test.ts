/**
 * Host route tests: the HTTP surface the browser half talks to.
 *
 * The route handler is driven directly with stub request/response objects, so
 * every branch — including the security checks and the failure payloads — is
 * covered without a running server.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouteHandler, readJsonBody, sameOrigin, sendJson } from '../src/route.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'
import { OptimizeError } from '../src/optimizer/provider.ts'

/** A context whose llm.stream yields one canned text block. */
function stubContext(options = {}) {
  return {
    logger: { info: () => {}, warn: () => {} },
    llm: {
      async *stream(request) {
        if (options.fail !== undefined) throw options.fail
        const text = options.text ?? 'OPTIMIZED'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    agentDefaultModel: options.agentDefaultModel,
  }
}

/** Build a handler with a fixed settings object. */
function makeHandler(options = {}) {
  let settings = { ...DEFAULT_SETTINGS, model: 'p/m', ...(options.settings ?? {}) }
  const handler = createRouteHandler({
    ctx: options.ctx ?? stubContext(options),
    getSettings: () => settings,
    setSettings: (next) => { settings = next; return settings },
    // Discovery now returns routes plus diagnostics, so an empty list can be
    // explained rather than merely shown.
    listRoutes: () => Promise.resolve(options.discovery ?? {
      routes: options.routes ?? [],
      llmAvailable: true,
      providerCount: (options.routes ?? []).length > 0 ? 1 : 0,
      failedProviders: [],
    }),
  })
  return { handler, get settings() { return settings } }
}

/**
 * Drive one request through a handler.
 * @returns the status and the parsed body.
 */
async function call(handler, method, url, body, headers = {}) {
  let status = 0
  let payload = ''
  const request = {
    method,
    url,
    headers: { host: 'localhost', ...headers },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
  const response = { writeHead(s) { status = s }, end(chunk) { payload = chunk ?? '' } }
  await handler(request, response)
  return { status, payload: payload.length > 0 ? JSON.parse(payload) : null }
}

// --- settings -------------------------------------------------------------

test('GET /settings returns the stored settings, defaults, and routes', async () => {
  const route = { provider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-chat', modelName: 'DeepSeek Chat', value: 'deepseek/deepseek-chat', efforts: [] }
  const { handler } = makeHandler({ routes: [route] })
  const result = await call(handler, 'GET', '/prompt-optimizer/settings')
  assert.equal(result.status, 200)
  assert.equal(result.payload.settings.model, 'p/m')
  assert.equal(result.payload.defaults.intensity, 'balanced')
  assert.deepEqual(result.payload.routes, [route])
  assert.deepEqual(result.payload.discovery, { llmAvailable: true, providerCount: 1, failedProviders: [] })
})

test('GET /settings reports why discovery found nothing', async () => {
  const { handler } = makeHandler({
    discovery: { routes: [], llmAvailable: true, providerCount: 2, failedProviders: ['deepseek'] },
  })
  const result = await call(handler, 'GET', '/prompt-optimizer/settings')
  assert.deepEqual(result.payload.routes, [])
  assert.deepEqual(result.payload.discovery, { llmAvailable: true, providerCount: 2, failedProviders: ['deepseek'] })
})

test('GET /settings survives a discovery failure', async () => {
  let settings = { ...DEFAULT_SETTINGS }
  const handler = createRouteHandler({
    ctx: stubContext(),
    getSettings: () => settings,
    setSettings: (next) => { settings = next; return settings },
    listRoutes: () => { throw new Error('llm exploded') },
  })
  const result = await call(handler, 'GET', '/prompt-optimizer/settings')
  assert.equal(result.status, 200)
  assert.deepEqual(result.payload.routes, [])
  assert.deepEqual(result.payload.discovery, { llmAvailable: false, providerCount: 0, failedProviders: [] })
})

test('GET /settings reports the parsed explicit route', async () => {
  const { handler } = makeHandler({ settings: { model: 'openai/gpt-x' } })
  const result = await call(handler, 'GET', '/prompt-optimizer/settings')
  assert.deepEqual(result.payload.explicitRoute, { provider: 'openai', model: 'gpt-x' })
})

test('GET /settings reports null for the "current" route', async () => {
  const { handler } = makeHandler({ settings: { model: 'current' } })
  const result = await call(handler, 'GET', '/prompt-optimizer/settings')
  assert.equal(result.payload.explicitRoute, null)
})

test('POST /settings persists a normalized settings object', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/settings', {
    settings: { intensity: 'deep', language: 'english', showPreview: false, bogus: 1 },
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.ok, true)
  assert.equal(result.payload.settings.intensity, 'deep')
  assert.equal(result.payload.settings.language, 'english')
  assert.equal(result.payload.settings.showPreview, false)
  assert.equal('bogus' in result.payload.settings, false)
})

test('POST /settings refuses an invalid enum instead of storing it', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/settings', { settings: { intensity: 'extreme' } })
  assert.equal(result.payload.settings.intensity, 'balanced')
})

test('POST /settings accepts an empty body as all-defaults', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/settings', {})
  assert.equal(result.status, 200)
  assert.equal(result.payload.settings.intensity, 'balanced')
})

test('/settings rejects other methods', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'DELETE', '/prompt-optimizer/settings')
  assert.equal(result.status, 405)
})

// --- optimize -------------------------------------------------------------

test('POST /optimize returns the optimized prompt and the plan', async () => {
  const { handler } = makeHandler({ text: '# Objective\n\n做后台。' })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '帮我做个好看的管理后台', requestId: 'r1' })
  assert.equal(result.status, 200)
  assert.equal(result.payload.requestId, 'r1')
  assert.equal(result.payload.optimized, '# Objective\n\n做后台。')
  assert.equal(result.payload.original, '帮我做个好看的管理后台')
  assert.equal(result.payload.plan.domainId, 'ui-design')
  assert.equal(result.payload.plan.intensity, 'balanced')
})

test('POST /optimize echoes the request id on a failure', async () => {
  const { handler } = makeHandler({ ctx: stubContext({ fail: Object.assign(new Error('nope'), { code: 'AUTH' }) }) })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r7' })
  assert.equal(result.status, 200)
  assert.equal(result.payload.requestId, 'r7')
  assert.equal(result.payload.code, 'AUTH')
})

test('a provider error without a code is reported as PROVIDER_ERROR', async () => {
  const ctx = {
    llm: { async *stream() { throw new TypeError('boom') } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    logger: { warn: () => {} },
  }
  const { handler } = makeHandler({ ctx })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r8' })
  assert.equal(result.payload.code, 'PROVIDER_ERROR')
  assert.equal(result.payload.requestId, 'r8')
})

test('an unexpected failure inside the handler is reported as ROUTE_ERROR', async () => {
  // A getSettings that throws is not an OptimizeError, so it exercises the
  // route-level catch rather than the optimizer's own failure taxonomy.
  const handler = createRouteHandler({
    ctx: stubContext(),
    getSettings: () => { throw new Error('settings exploded') },
    setSettings: (next) => next,
    listRoutes: () => [],
  })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r9' })
  assert.equal(result.status, 500)
  assert.equal(result.payload.code, 'ROUTE_ERROR')
})

test('POST /optimize rejects an empty draft without calling the model', async () => {
  let called = false
  const ctx = {
    llm: { async *stream() { called = true; yield { type: 'finish', reason: { kind: 'stop' } } } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    logger: { warn: () => {} },
  }
  const { handler } = makeHandler({ ctx })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '   ', requestId: 'r2' })
  assert.equal(result.payload.code, 'EMPTY_DRAFT')
  assert.equal(called, false)
})

test('POST /optimize no-ops a greeting without calling the model', async () => {
  let called = false
  const ctx = {
    llm: { async *stream() { called = true; yield { type: 'finish', reason: { kind: 'stop' } } } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    logger: { warn: () => {} },
  }
  const { handler } = makeHandler({ ctx })
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '你好', requestId: 'r3' })
  assert.equal(result.payload.optimized, '你好')
  assert.equal(result.payload.plan.noop, true)
  assert.equal(called, false)
})

test('POST /optimize honors a per-call intensity override', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r', intensity: 'light' })
  assert.equal(result.payload.plan.intensity, 'light')
})

test('POST /optimize honors a per-call language override', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r', language: 'english' })
  assert.equal(result.payload.plan.language, 'english')
})

test('POST /optimize reports the ranked domain evidence', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '用 React 写一个管理后台 UI', requestId: 'r' })
  assert.ok(result.payload.plan.ranked.length >= 1)
  assert.equal(typeof result.payload.plan.ranked[0].score, 'number')
})

test('/optimize rejects GET', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'GET', '/prompt-optimizer/optimize')
  assert.equal(result.status, 405)
})

// --- routing --------------------------------------------------------------

test('an unknown path under the prefix is a 404', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'GET', '/prompt-optimizer/nope')
  assert.equal(result.status, 404)
})

test('the query string does not affect routing', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'GET', '/prompt-optimizer/settings?x=1')
  assert.equal(result.status, 200)
})

test('the health route reports ok', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'GET', '/prompt-optimizer/health')
  assert.equal(result.payload.ok, true)
})

test('a malformed JSON body yields a 500, not a crash', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/settings', '{ not json')
  assert.equal(result.status, 500)
  assert.equal(result.payload.code, 'ROUTE_ERROR')
})

// --- CSRF -----------------------------------------------------------------

test('sameOrigin accepts a missing Origin (desktop shell relay)', () => {
  assert.equal(sameOrigin({ headers: { host: 'localhost' } }), true)
  assert.equal(sameOrigin({ headers: { host: 'localhost', origin: '' } }), true)
})

test('sameOrigin accepts the desktop shell protocol', () => {
  assert.equal(sameOrigin({ headers: { host: 'localhost', origin: 'dsh-app://app' } }), true)
})

test('sameOrigin accepts a matching host', () => {
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' } }), true)
})

test('sameOrigin refuses a cross-site origin', () => {
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:19387', origin: 'https://evil.example' } }), false)
})

test('sameOrigin refuses a malformed origin', () => {
  assert.equal(sameOrigin({ headers: { host: 'localhost', origin: 'not a url' } }), false)
})

test('sameOrigin refuses when Host is absent', () => {
  assert.equal(sameOrigin({ headers: { origin: 'http://x.example' } }), false)
})

test('a cross-site POST is refused with 403', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'POST', '/prompt-optimizer/optimize', { text: '做个后台', requestId: 'r' }, { origin: 'https://evil.example' })
  assert.equal(result.status, 403)
})

test('a cross-site settings write is refused with 403', async () => {
  const { handler, settings } = makeHandler()
  const before = settings.intensity
  const result = await call(handler, 'POST', '/prompt-optimizer/settings', { settings: { intensity: 'deep' } }, { origin: 'https://evil.example' })
  assert.equal(result.status, 403)
  assert.equal(settings.intensity, before)
})

test('a GET is not origin-checked', async () => {
  const { handler } = makeHandler()
  const result = await call(handler, 'GET', '/prompt-optimizer/settings', undefined, { origin: 'https://evil.example' })
  assert.equal(result.status, 200)
})

// --- body handling --------------------------------------------------------

test('readJsonBody parses an object body', async () => {
  const request = { async *[Symbol.asyncIterator]() { yield Buffer.from('{"a":1}') } }
  assert.deepEqual(await readJsonBody(request), { a: 1 })
})

test('readJsonBody treats an empty body as an empty object', async () => {
  const request = { async *[Symbol.asyncIterator]() { yield Buffer.from('   ') } }
  assert.deepEqual(await readJsonBody(request), {})
})

test('readJsonBody refuses an oversized body', async () => {
  const request = { async *[Symbol.asyncIterator]() { yield Buffer.alloc(600 * 1024) } }
  await assert.rejects(() => readJsonBody(request), /too large/)
})

test('sendJson sets a no-store JSON content type', () => {
  let headers = null
  let body = ''
  sendJson({ writeHead: (status, h) => { headers = { status, ...h } }, end: (chunk) => { body = chunk } }, 200, { a: 1 })
  assert.equal(headers.status, 200)
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(headers['cache-control'], 'no-store')
  assert.equal(body, '{"a":1}')
})
