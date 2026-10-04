/**
 * Settings tests: normalization, persistence, atomicity, and route parsing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseModelRoute,
  readSettings,
  resolveDshHome,
  settingsPath,
  writeSettings,
} from '../src/settings.ts'

/** A throwaway directory for one test. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'dshpo-'))
  return { dir, path: join(dir, 'prompt-optimizer.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('defaults match the documented contract', () => {
  assert.equal(DEFAULT_SETTINGS.model, 'current')
  assert.equal(DEFAULT_SETTINGS.intensity, 'balanced')
  assert.equal(DEFAULT_SETTINGS.language, 'auto')
  assert.equal(DEFAULT_SETTINGS.autoDetectDomain, true)
  assert.equal(DEFAULT_SETTINGS.showPreview, true)
  assert.equal(DEFAULT_SETTINGS.useConversationContext, true)
  assert.equal(DEFAULT_SETTINGS.useProjectContext, true)
  assert.equal(DEFAULT_SETTINGS.minecraftOptimization, true)
  assert.equal(DEFAULT_SETTINGS.enableVisionContext, true)
  assert.equal(DEFAULT_SETTINGS.customInstructions, '')
})

test('normalizeSettings fills every field from garbage input', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings('nonsense'), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings(42), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
})

test('an invalid enum degrades to its default rather than persisting', () => {
  assert.equal(normalizeSettings({ intensity: 'extreme' }).intensity, 'balanced')
  assert.equal(normalizeSettings({ language: 'klingon' }).language, 'auto')
})

test('a partial object keeps the fields it does specify', () => {
  const result = normalizeSettings({ intensity: 'deep', showPreview: false })
  assert.equal(result.intensity, 'deep')
  assert.equal(result.showPreview, false)
  assert.equal(result.model, 'current')
})

test('non-boolean values never become true by accident', () => {
  assert.equal(normalizeSettings({ showPreview: 'yes' }).showPreview, true)
  assert.equal(normalizeSettings({ showPreview: 0 }).showPreview, true)
  assert.equal(normalizeSettings({ showPreview: false }).showPreview, false)
})

test('a corrupt file degrades to defaults instead of throwing', () => {
  const s = scratch()
  try {
    writeFileSync(s.path, '{ not json', 'utf8')
    assert.deepEqual(readSettings(s.path), DEFAULT_SETTINGS)
  } finally {
    s.cleanup()
  }
})

test('a missing file yields defaults', () => {
  const s = scratch()
  try {
    assert.deepEqual(readSettings(join(s.dir, 'absent.json')), DEFAULT_SETTINGS)
  } finally {
    s.cleanup()
  }
})

test('writeSettings then readSettings round-trips', () => {
  const s = scratch()
  try {
    const written = writeSettings({ ...DEFAULT_SETTINGS, intensity: 'deep', customInstructions: '简洁优先' }, s.path)
    assert.equal(written.intensity, 'deep')
    const read = readSettings(s.path)
    assert.equal(read.intensity, 'deep')
    assert.equal(read.customInstructions, '简洁优先')
  } finally {
    s.cleanup()
  }
})

test('writeSettings creates missing parent directories', () => {
  const s = scratch()
  try {
    const nested = join(s.dir, 'a', 'b', 'settings.json')
    writeSettings(DEFAULT_SETTINGS, nested)
    assert.equal(readSettings(nested).intensity, 'balanced')
  } finally {
    s.cleanup()
  }
})

test('writeSettings leaves no temp file behind', () => {
  const s = scratch()
  try {
    writeSettings(DEFAULT_SETTINGS, s.path)
    const entries = readFileSync(s.path, 'utf8')
    assert.ok(entries.includes('"intensity"'))
    // The rename is atomic, so the temp sibling is gone.
    assert.throws(() => readFileSync(`${s.path}.tmp-${process.pid}`, 'utf8'))
  } finally {
    s.cleanup()
  }
})

test('the file on disk is valid JSON with a trailing newline', () => {
  const s = scratch()
  try {
    writeSettings(DEFAULT_SETTINGS, s.path)
    const raw = readFileSync(s.path, 'utf8')
    assert.ok(raw.endsWith('\n'))
    assert.doesNotThrow(() => JSON.parse(raw))
  } finally {
    s.cleanup()
  }
})

test('customInstructions is capped, not rejected', () => {
  const huge = 'x'.repeat(20000)
  assert.equal(normalizeSettings({ customInstructions: huge }).customInstructions.length, 8000)
})

// --- route parsing --------------------------------------------------------

test('"current" means follow the session', () => {
  assert.equal(parseModelRoute('current'), undefined)
  assert.equal(parseModelRoute(''), undefined)
  assert.equal(parseModelRoute('   '), undefined)
})

test('provider/model parses into a route', () => {
  assert.deepEqual(parseModelRoute('deepseek/deepseek-chat'), { provider: 'deepseek', model: 'deepseek-chat' })
})

test('a model id containing slashes keeps the rest intact', () => {
  assert.deepEqual(parseModelRoute('openrouter/meta/llama-3'), { provider: 'openrouter', model: 'meta/llama-3' })
})

test('malformed routes are rejected rather than half-parsed', () => {
  assert.equal(parseModelRoute('/model'), undefined)
  assert.equal(parseModelRoute('provider/'), undefined)
  assert.equal(parseModelRoute('noslash'), undefined)
})

test('a model value is trimmed and length-capped', () => {
  assert.equal(normalizeSettings({ model: '  current  ' }).model, 'current')
  assert.ok(normalizeSettings({ model: 'x'.repeat(500) }).model.length <= 200)
})

// --- home resolution ------------------------------------------------------

test('DSH_HOME overrides the default home', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'D:/custom' }), 'D:/custom')
  assert.ok(resolveDshHome({}).endsWith('.dsh'))
})

test('settingsPath lives directly under DSH_HOME', () => {
  // Normalize separators: path.join uses the platform separator.
  const path = settingsPath({ DSH_HOME: 'D:/custom' }).replaceAll('\\', '/')
  assert.ok(path.startsWith('D:/custom'))
  assert.ok(path.endsWith('prompt-optimizer.json'))
})

test('an empty reasoning effort is the default, so no route is forced', () => {
  // Most providers expose no efforts at all, so pinning one must never be required.
  assert.equal(DEFAULT_SETTINGS.reasoningEffort, '')
})

test('a reasoning effort is trimmed and length-capped', () => {
  assert.equal(normalizeSettings({ reasoningEffort: '  high  ' }).reasoningEffort, 'high')
  assert.equal(normalizeSettings({ reasoningEffort: '   ' }).reasoningEffort, '')
  assert.ok(normalizeSettings({ reasoningEffort: 'x'.repeat(500) }).reasoningEffort.length <= 100)
})

test('an unknown reasoning effort is preserved, not validated away', () => {
  // The plugin cannot know which ids a route accepts, and the adapter rejects
  // an unsupported one itself. Dropping it here would silently undo the choice.
  assert.equal(normalizeSettings({ reasoningEffort: 'very-high' }).reasoningEffort, 'very-high')
})

