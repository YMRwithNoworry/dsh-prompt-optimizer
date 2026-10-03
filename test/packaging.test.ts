/**
 * Packaging constraints.
 *
 * The host half runs through Node's TypeScript type-stripping, which refuses
 * `.ts` files under `node_modules`. That produces a hard failure the moment a
 * profile installs the package — so the constraints it implies are asserted
 * here rather than discovered in a user's log.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const SOURCE_FILES = walk(join(ROOT, 'src'))

test('the host half has source files to check', () => {
  assert.ok(SOURCE_FILES.length >= 8)
})

test('the built host half exists', () => {
  // Node refuses type-stripping under node_modules, so the package that a
  // profile installs must contain compiled JavaScript. Shipping only src/ would
  // fail on the user's machine while every source-level test still passed.
  assert.ok(existsSync(join(ROOT, 'dist', 'index.js')), 'dist/index.js is missing — run npm run build')
  assert.ok(existsSync(join(ROOT, 'dist', 'config.js')))
})

test('no emitted module still imports a .ts specifier', () => {
  const offenders = []
  for (const file of walk(join(ROOT, 'dist'))) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'([^']*\.ts)'/g)) {
      offenders.push(relative(ROOT, file) + ' -> ' + match[1])
    }
  }
  assert.deepEqual(offenders, [], 'a .ts specifier in dist fails at runtime: ' + offenders.join(', '))
})

test('every emitted module resolves', () => {
  const missing = []
  for (const file of walk(join(ROOT, 'dist'))) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.\.?\/[^']*)'/g)) {
      if (!existsSync(join(dirname(file), match[1]))) missing.push(relative(ROOT, file) + ' -> ' + match[1])
    }
  }
  assert.deepEqual(missing, [], 'unresolvable emitted imports: ' + missing.join(', '))
})

test('the build output is newer than the sources it came from', () => {
  // A stale dist ships old behaviour; the build script clears dist for exactly
  // this reason, and this test catches a hand-edited source that was never rebuilt.
  const emitted = statSync(join(ROOT, 'dist', 'index.js')).mtimeMs
  const stale = SOURCE_FILES
    .filter((file) => file.endsWith('.ts') || file.endsWith('.js'))
    .filter((file) => statSync(file).mtimeMs > emitted + 1000)
    .map((file) => relative(ROOT, file))
  assert.deepEqual(stale, [], 'dist is stale relative to: ' + stale.join(', '))
})

test('every relative import carries an explicit extension', () => {
  const offenders = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.\.?\/[^']*)'/g)) {
      const specifier = match[1]
      if (!/\.(ts|js|json)$/.test(specifier)) offenders.push(relative(ROOT, file) + ' -> ' + specifier)
    }
  }
  assert.deepEqual(offenders, [], 'Node requires explicit extensions: ' + offenders.join(', '))
})

test('every relative import resolves to a file that exists', () => {
  const missing = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.\.?\/[^']*)'/g)) {
      const target = join(dirname(file), match[1])
      if (!existsSync(target)) missing.push(relative(ROOT, file) + ' -> ' + match[1])
    }
  }
  assert.deepEqual(missing, [], 'unresolvable imports: ' + missing.join(', '))
})

test('no relative import points at a bare directory', () => {
  // `from './optimizer'` would need a resolver Node does not provide for ESM.
  const offenders = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'(\.\.?\/[^']*)'/g)) {
      const target = join(dirname(file), match[1])
      if (existsSync(target) && statSync(target).isDirectory()) offenders.push(relative(ROOT, file) + ' -> ' + match[1])
    }
  }
  assert.deepEqual(offenders, [], 'directory imports: ' + offenders.join(', '))
})

test('the package entry points exist and are declared', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  for (const [key, value] of Object.entries(pkg.exports)) {
    if (key === './package.json') continue
    const target = typeof value === 'string' ? value : value.default
    assert.ok(existsSync(join(ROOT, target)), 'exports[' + key + '] -> ' + target + ' does not exist')
  }
  assert.ok(existsSync(join(ROOT, pkg.main)), 'main -> ' + pkg.main + ' does not exist')
})

test('the bundle patch is declared and exists', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const patch = pkg.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  assert.ok(existsSync(join(ROOT, patch)))
})

test('the client declaration matches the module-loader contract', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.dsh?.client?.platform, 'web')
  const clientPath = pkg.exports['./client']
  const target = typeof clientPath === 'string' ? clientPath : clientPath.default
  const source = readFileSync(join(ROOT, target), 'utf8')
  // The registration id must equal the package name, or the graph row never matches.
  assert.ok(source.includes('window.__ModuleLoader__.load({ id: "' + pkg.name + '"'))
  // The factory must export the plugin face Cordis consumes.
  for (const field of ['exports.name', 'exports.inject', 'exports.apply']) {
    assert.ok(source.includes(field), 'client must export ' + field)
  }
})

test('the bundle patch mounts a row named after the package', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const patch = readFileSync(join(ROOT, pkg.dsh.bundle.patch), 'utf8')
  assert.ok(patch.includes("name: '" + pkg.name + "'"), 'patch must insert a row named ' + pkg.name)
  assert.ok(/^- insert:/m.test(patch), 'patch must be a top-level array of insert entries')
})

test('the client bundle parses as JavaScript', async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const target = pkg.exports['./client']
  const source = readFileSync(join(ROOT, typeof target === 'string' ? target : target.default), 'utf8')
  // `new Function` runs the real parser over the real bytes.
  assert.doesNotThrow(() => new Function(source))
})

test('the host half carries no build-only import', () => {
  // A runtime dependency on a bundler or a dev-only package would break the
  // profile, which installs production dependencies only.
  const offenders = []
  for (const file of SOURCE_FILES) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from\s+'([^'.][^']*)'/g)) {
      const specifier = match[1]
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('@deepseek-ai/')) continue
      offenders.push(relative(ROOT, file) + ' -> ' + specifier)
    }
  }
  assert.deepEqual(offenders, [], 'unexpected runtime dependencies: ' + offenders.join(', '))
})
