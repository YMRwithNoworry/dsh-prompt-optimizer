/**
 * Model discovery tests.
 *
 * Discovery reads the harness's own LLM service, so every failure mode here is
 * an adapter misbehaving rather than a bug in the plugin. The tests therefore
 * concentrate on the degradation paths: a missing service, a provider that
 * throws, an adapter with no reasoning metadata, and a route whose listing
 * never returns.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverModelRoutes } from '../src/optimizer/model-routes.ts'

/** Build a stub LLM service. */
function stubLlm(overrides = {}) {
  return {
    listProviders: () => [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'op', name: 'OpenAI' },
    ],
    listModels: async (provider) => provider === 'deepseek'
      ? [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }]
      : [{ id: 'gpt-x' }],
    resolveModelInfo: async (provider, model) => model === 'deepseek-reasoner'
      ? { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'slower' }], defaultEffort: 'high' } }
      : {},
    ...overrides,
  }
}

test('no LLM service yields no routes', async () => {
  assert.deepEqual(await discoverModelRoutes(undefined), [])
  assert.deepEqual(await discoverModelRoutes({}), [])
})

test('every provider and model becomes one route option', async () => {
  const routes = await discoverModelRoutes(stubLlm())
  assert.deepEqual(routes.map((r) => r.value), [
    'deepseek/deepseek-chat',
    'deepseek/deepseek-reasoner',
    'op/gpt-x',
  ])
})

test('a route carries its provider and model display names', async () => {
  const routes = await discoverModelRoutes(stubLlm())
  assert.deepEqual(
    routes.map((r) => [r.providerName, r.modelName]),
    [['DeepSeek', 'DeepSeek Chat'], ['DeepSeek', 'DeepSeek Reasoner'], ['OpenAI', 'gpt-x']],
  )
})

test('a model without a display name falls back to its id', async () => {
  const routes = await discoverModelRoutes(stubLlm())
  const last = routes[routes.length - 1]
  assert.equal(last.modelName, 'gpt-x')
})

test('reasoning efforts are carried per route', async () => {
  const routes = await discoverModelRoutes(stubLlm())
  assert.deepEqual(routes[0].efforts, [])
  assert.deepEqual(routes[1].efforts, [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High', description: 'slower' },
  ])
})

test('a route default effort is carried', async () => {
  const routes = await discoverModelRoutes(stubLlm())
  assert.equal(routes[1].defaultEffort, 'high')
  assert.equal(routes[0].defaultEffort, undefined)
})

test('an effort without a name falls back to its id', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'medium' }] } }),
  }))
  assert.deepEqual(routes[0].efforts, [{ id: 'medium', name: 'medium' }])
})

test('a malformed effort entry is skipped, not propagated', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ name: 'no id' }, null, { id: 'ok', name: 'OK' }] } }),
  }))
  assert.deepEqual(routes[0].efforts, [{ id: 'ok', name: 'OK' }])
})

test('a provider that throws on listing is skipped without failing the pass', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    listModels: async (provider) => {
      if (provider === 'deepseek') throw new Error('adapter down')
      return [{ id: 'gpt-x' }]
    },
  }))
  assert.deepEqual(routes.map((r) => r.value), ['op/gpt-x'])
})

test('a provider that never answers is abandoned on timeout', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    listModels: async (provider) => {
      if (provider === 'deepseek') return new Promise(() => {})
      return [{ id: 'gpt-x' }]
    },
  }))
  assert.deepEqual(routes.map((r) => r.value), ['op/gpt-x'])
})

test('a failing effort lookup still offers the route', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    resolveModelInfo: async () => { throw new Error('unsupported') },
  }))
  assert.equal(routes.length, 3)
  assert.deepEqual(routes[0].efforts, [])
})

test('listProviders throwing yields no routes', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    listProviders: () => { throw new Error('nope') },
  }))
  assert.deepEqual(routes, [])
})

test('a provider without an id is skipped', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    listProviders: () => [{ name: 'Anonymous' }, { id: 'ok', name: 'OK' }],
    listModels: async () => [{ id: 'm' }],
  }))
  assert.deepEqual(routes.map((r) => r.value), ['ok/m'])
})

test('a model without an id is skipped', async () => {
  const routes = await discoverModelRoutes(stubLlm({
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => [{ name: 'nameless' }, { id: 'm' }],
  }))
  assert.deepEqual(routes.map((r) => r.value), ['p/m'])
})

test('a non-array provider listing yields no routes', async () => {
  const routes = await discoverModelRoutes(stubLlm({ listProviders: () => undefined }))
  assert.deepEqual(routes, [])
})

test('a non-array model listing is skipped', async () => {
  const routes = await discoverModelRoutes(stubLlm({ listModels: async () => undefined }))
  assert.deepEqual(routes, [])
})

test('an aborted signal stops discovery', async () => {
  const controller = new AbortController()
  controller.abort()
  const routes = await discoverModelRoutes(stubLlm(), controller.signal)
  assert.deepEqual(routes, [])
})

test('a composition without listModels yields no routes', async () => {
  const routes = await discoverModelRoutes({ listProviders: () => [{ id: 'p', name: 'P' }] })
  assert.deepEqual(routes, [])
})

test('routes are capped so one huge provider cannot flood the panel', async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ id: 'm' + i }))
  const routes = await discoverModelRoutes(stubLlm({
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => many,
  }))
  assert.ok(routes.length <= 200, 'expected a cap, got ' + routes.length)
})
