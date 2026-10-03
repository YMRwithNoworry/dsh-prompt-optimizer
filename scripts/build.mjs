/**
 * Build the host half.
 *
 * `tsc` compiles the TypeScript sources into `dist/`, rewriting the explicit
 * `.ts` import specifiers to `.js`. The one file it cannot handle is
 * `src/config.js` — plain JavaScript, kept annotation-free on purpose — so this
 * script copies it and its declaration file alongside the compiled output.
 *
 * @module dsh-prompt-optimizer/scripts/build
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')

/** Every `.js` file under a directory, recursively. */
function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkJs(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

// A stale dist silently ships old code, so it is rebuilt from scratch.
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const tsc = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')
if (!existsSync(tsc)) {
  console.error('build: typescript is not installed; run `npm install` first')
  process.exit(1)
}
execFileSync(process.execPath, [tsc, '--project', join(root, 'tsconfig.json')], { stdio: 'inherit' })

// The annotation-free JavaScript module travels with the build. Its import of
// `./settings.ts` must become `./settings.js`: the built tree is plain
// JavaScript, so nothing will strip a `.ts` specifier for it.
const configSource = readFileSync(join(root, 'src', 'config.js'), 'utf8')
const configBuilt = configSource.replace(/from '(\.[^']*)\.ts'/g, "from '$1.js'")
writeFileSync(join(dist, 'config.js'), configBuilt, 'utf8')
copyFileSync(join(root, 'src', 'config.d.ts'), join(dist, 'config.d.ts'))

// A `.ts` specifier surviving into dist would fail at runtime, so the build
// refuses to finish rather than shipping it.
const stale = []
for (const file of walkJs(dist)) {
  if (/\.ts['"]/.test(readFileSync(file, 'utf8'))) stale.push(file)
}
if (stale.length > 0) {
  console.error('build: these emitted files still import a .ts specifier:')
  for (const file of stale) console.error('  ' + file)
  process.exit(1)
}

console.log('build: dist/ is up to date')
