/**
 * Copy-table integrity.
 *
 * A duplicated key in TEXT or ERROR_TEXT silently overwrites the earlier
 * entry — which is exactly how the diff pane once rendered the label of the
 * language selector. This test parses the two tables out of the client bundle
 * and fails on any duplicate.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT_SOURCE = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

/**
 * Extract the keys of one object literal from the bundle.
 * @param name - the `var <name> = {` declaration to read.
 * @returns its top-level keys, in source order.
 */
function tableKeys(name) {
  const start = CLIENT_SOURCE.indexOf('var ' + name + ' = {')
  assert.notEqual(start, -1, 'missing table ' + name)
  const end = CLIENT_SOURCE.indexOf('\n\t};', start)
  assert.notEqual(end, -1, 'unterminated table ' + name)
  const body = CLIENT_SOURCE.slice(start, end)
  return [...body.matchAll(/^\t\t([A-Za-z_$][\w$]*):/gm)].map((match) => match[1])
}

test('TEXT has no duplicate keys', () => {
  const keys = tableKeys('TEXT')
  assert.ok(keys.length > 40, 'expected a substantial copy table, got ' + keys.length)
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  assert.deepEqual(duplicates, [], 'duplicate TEXT keys: ' + duplicates.join(', '))
})

test('ERROR_TEXT has no duplicate keys', () => {
  const keys = tableKeys('ERROR_TEXT')
  assert.ok(keys.length >= 8)
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
  assert.deepEqual(duplicates, [], 'duplicate ERROR_TEXT keys: ' + duplicates.join(', '))
})

test('the diff pane and the language selector use different labels', () => {
  const keys = tableKeys('TEXT')
  assert.ok(keys.includes('original'))
  assert.ok(keys.includes('langOriginal'))
  assert.notEqual(keys.indexOf('original'), keys.indexOf('langOriginal'))
})

test('every statically referenced copy key is defined', () => {
  const keys = new Set([...tableKeys('TEXT'), ...tableKeys('ERROR_TEXT')])
  // Only literal lookups are checked; `ERROR_TEXT[code]` is a dynamic read of a
  // server-supplied code and is covered by the fallback branch instead.
  const referenced = new Set([
    ...[...CLIENT_SOURCE.matchAll(/TEXT\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...CLIENT_SOURCE.matchAll(/ERROR_TEXT\["([A-Z_]+)"\]/g)].map((m) => m[1]),
  ])
  const missing = [...referenced].filter((key) => !keys.has(key))
  assert.deepEqual(missing, [], 'copy keys used but not defined: ' + missing.join(', '))
})

test('an unknown server error code falls back to generic copy', () => {
  // The panel must never render a raw code as the only explanation.
  assert.ok(CLIENT_SOURCE.includes('ERROR_TEXT[code] ||'))
})
