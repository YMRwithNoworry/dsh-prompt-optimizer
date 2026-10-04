/**
 * Plugin-face shape tests.
 *
 * Cordis normalizes `inject` with `Inject.resolve`, which for an object turns
 * every KEY into a required service name and every VALUE into that service's
 * intercept config. A declaration like
 *
 *     { optional: ['webServer', 'llm'] }
 *
 * therefore registers a required service literally named `optional` — and the
 * plugin waits for it forever, loading nothing. That is a silent total failure,
 * so the accepted shapes are pinned here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

/**
 * Reproduce cordis's `Inject.resolve` exactly.
 * @param inject - the declaration to normalize.
 * @returns service name -> intercept config.
 */
function resolveInject(inject) {
  const result = Object.create(null)
  if (!inject) return result
  if (Array.isArray(inject)) { for (const name of inject) result[name] = null; return result }
  for (const name of Object.keys(inject)) result[name] = inject[name] ?? null
  return result
}

/** The host half's declared plugin face. */
async function hostFace() {
  return import(new URL('../dist/index.js', import.meta.url).href)
}

/** The client half's declared plugin face, read out of the bundle. */
function clientFace() {
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let face = null
  const windowStub = {
    __ModuleLoader__: {
      load({ id, factory }) {
        face = factory((specifier) => {
          if (specifier === 'react') return { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: () => ({ current: null }) }
          throw new Error('unexpected require: ' + specifier)
        })
        face.__id = id
      },
    },
    crypto: { getRandomValues: (array) => array },
  }
  const documentStub = { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {}, activeElement: null }
  const scope = { window: windowStub, document: documentStub }
  new Function('window', 'document', 'globalThis', source).call(scope, windowStub, documentStub, scope)
  return face
}

test('the host half requires no service, so it never waits on one', async () => {
  const face = await hostFace()
  const required = Object.keys(resolveInject(face.inject))
  assert.deepEqual(required, [], 'the host half must start in any composition')
})

test('the host half reaches optional services through ctx.inject instead', async () => {
  const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  assert.ok(source.includes('resolveServices'), 'services must be resolved through one helper')
  // And it must not name llm/webServer in the required list.
  const declaration = /export const inject[^=]*=\s*([^\n]+)/.exec(source)
  assert.ok(declaration !== null, 'the inject declaration must be present')
  assert.ok(!declaration[1].includes('webServer'), 'webServer must not be required')
  assert.ok(!declaration[1].includes('llm'), 'llm must not be required')
})

test('the host half never reads a service directly off ctx', () => {
  // Cordis's context proxy traps a service read from a fiber that did not
  // declare it and returns undefined. A direct `ctx.llm` therefore looks
  // correct and silently disables every LLM-backed feature: discovery reported
  // zero providers, and the optimizer would have failed with NO_ROUTE — with
  // nothing in the log to explain it.
  const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  const code = source.split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n')
  for (const service of ['llm', 'agentDefaultModel', 'webServer']) {
    assert.ok(!code.includes('ctx.' + service), 'read ' + service + ' through the resolved view, not ctx')
  }
})

test('resolveServices reads each service from its injected scope', () => {
  const source = readFileSync(join(ROOT, 'src', 'index.ts'), 'utf8')
  const body = /function resolveServices[\s\S]*?\n}/.exec(source)
  assert.ok(body !== null, 'resolveServices must exist')
  // The value must come from the injected scope: that is the only context in
  // which cordis resolves a service the plugin does not require.
  assert.ok(body[0].includes('scoped[name]'), 'the service must be read from the injected scope')
  assert.ok(body[0].includes('ctx.inject'), 'the scope comes from ctx.inject')
})

test('no inject declaration names a service called "optional"', async () => {
  // The exact shape that caused the silent load failure.
  const host = await hostFace()
  assert.deepEqual(Object.keys(resolveInject(host.inject)), [])
  const client = clientFace()
  assert.deepEqual(Object.keys(resolveInject(client.inject)), ['slots'])
})

test('the client half requires exactly the slots service', () => {
  const face = clientFace()
  assert.deepEqual(face.inject, ['slots'])
  assert.equal(typeof face.apply, 'function')
  assert.equal(face.name, 'prompt-optimizer')
})

test('resolveInject treats an array as service names and an object as a map', () => {
  // Pins the semantics this file's assertions rely on.
  assert.deepEqual(Object.keys(resolveInject(['a', 'b'])), ['a', 'b'])
  assert.deepEqual(Object.keys(resolveInject({ a: null, b: {} })), ['a', 'b'])
  assert.deepEqual(Object.keys(resolveInject({ optional: ['a'] })), ['optional'])
})

test('the host half exposes the plugin face the loader reads', async () => {
  const face = await hostFace()
  assert.equal(face.name, 'prompt-optimizer')
  assert.equal(typeof face.apply, 'function')
  assert.equal(typeof face.default, 'object')
  assert.equal(face.default.name, 'prompt-optimizer')
  assert.equal(face.default.apply, face.apply)
})
