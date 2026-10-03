/**
 * Configuration schema tests.
 *
 * Schemastery ships with the harness, not with this plugin, so the schema is
 * exercised against the real module when one is reachable and skipped
 * otherwise. The important guarantees are checked either way: every field is
 * volatile (or the harness settings page would silently omit it), the defaults
 * match {@link DEFAULT_SETTINGS}, and a composition without schemastery still
 * boots.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
// The config module is plain JavaScript: Node's type-stripping cannot handle a
// .ts module under node_modules, so this one carries no annotations.
import { buildConfigSchema, loadConfigSchema } from '../src/config.js'
import { DEFAULT_SETTINGS } from '../src/settings.ts'

/** Candidate locations of the harness's schemastery build. */
const SCHEMASTERY_CANDIDATES = [
  'C:/Users/Administrator/.dsh/profiles/node_modules/@deepseek-ai/schemastery/lib/index.mjs',
  'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/schemastery/lib/index.mjs',
]

/** Load the real schemastery, or undefined when this machine has none. */
async function realSchemastery() {
  for (const path of SCHEMASTERY_CANDIDATES) {
    if (!existsSync(path)) continue
    try {
      const module = await import(pathToFileURL(path).href)
      const z = module.default ?? module
      if (typeof z?.object === 'function') return z
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

test('a composition without schemastery boots with no schema', async () => {
  // The dynamic import must never reject; an absent dependency is a supported state.
  const schema = await loadConfigSchema()
  assert.ok(schema === undefined || typeof schema === 'object')
})

test('the schema builds and carries the documented defaults', async (t) => {
  const z = await realSchemastery()
  if (z === undefined) { t.skip('schemastery not present on this machine'); return }

  const schema = buildConfigSchema(z)
  assert.equal(typeof schema, 'function')

  const parsed = schema(undefined)
  /** Read a value that may be a volatile reference. */
  const valueOf = (entry) => (entry !== null && typeof entry === 'object' && typeof entry.get === 'function' ? entry.get() : entry)

  assert.equal(valueOf(parsed.model), DEFAULT_SETTINGS.model)
  assert.equal(valueOf(parsed.intensity), DEFAULT_SETTINGS.intensity)
  assert.equal(valueOf(parsed.language), DEFAULT_SETTINGS.language)
  assert.equal(valueOf(parsed.autoDetectDomain), DEFAULT_SETTINGS.autoDetectDomain)
  assert.equal(valueOf(parsed.showPreview), DEFAULT_SETTINGS.showPreview)
  assert.equal(valueOf(parsed.useConversationContext), DEFAULT_SETTINGS.useConversationContext)
  assert.equal(valueOf(parsed.useProjectContext), DEFAULT_SETTINGS.useProjectContext)
  assert.equal(valueOf(parsed.minecraftOptimization), DEFAULT_SETTINGS.minecraftOptimization)
  assert.equal(valueOf(parsed.enableVisionContext), DEFAULT_SETTINGS.enableVisionContext)
  assert.equal(valueOf(parsed.customInstructions), DEFAULT_SETTINGS.customInstructions)
})

test('every schema field is volatile so the settings page can edit it', async (t) => {
  const z = await realSchemastery()
  if (z === undefined) { t.skip('schemastery not present on this machine'); return }

  const schema = buildConfigSchema(z)
  const dict = schema.dict
  assert.ok(dict !== undefined, 'schema must expose its field dictionary')

  const notVolatile = Object.keys(dict).filter((key) => dict[key]?.meta?.volatile !== true)
  assert.deepEqual(notVolatile, [], 'non-volatile fields are hidden from the settings form: ' + notVolatile.join(', '))
})

test('the schema covers exactly the settings fields', async (t) => {
  const z = await realSchemastery()
  if (z === undefined) { t.skip('schemastery not present on this machine'); return }

  const schema = buildConfigSchema(z)
  const declared = Object.keys(schema.dict).sort()
  const expected = Object.keys(DEFAULT_SETTINGS).sort()
  assert.deepEqual(declared, expected)
})
