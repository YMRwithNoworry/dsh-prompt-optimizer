/**
 * Copy the built plugin into a DSH profile without pnpm.
 *
 * Why this exists: `pnpm install` swaps directories by removing the old one and
 * renaming the new one in. When the DSH app is running it holds the profile's
 * package directories open, the swap fails partway, and the package is left as
 * an empty shell — which `pnpm install` then cannot repair, because a retry hits
 * the same lock. That is exactly how a development session broke
 * `dsh-plugin-product-design`.
 *
 * This script writes files in place instead. A per-file copy has no directory
 * swap, so it works with the app running and cannot leave a package half-removed.
 * It updates an already-installed plugin; the first install still needs pnpm
 * (or the app's own plugin manager) to record the dependency.
 *
 * Usage:
 *   node scripts/sync-to-profile.mjs [profileName] [--check]
 *
 * @module dsh-prompt-optimizer/scripts/sync-to-profile
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE = 'dsh-prompt-optimizer'

/** Everything that ships, relative to the package root. */
const SHIPPED = ['dist', 'lib', 'src', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE']

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const profile = args.find((a) => !a.startsWith('-')) ?? 'desktop'

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const target = join(dshHome, 'profiles', profile, 'node_modules', PACKAGE)

if (!existsSync(join(target, 'package.json'))) {
  console.error(`sync: ${PACKAGE} is not installed in profile "${profile}".`)
  console.error(`sync: install it once with the DSH app stopped, then re-run this to update:`)
  console.error(`sync:   dsh plugin --profile ${profile} add ${ROOT}`)
  process.exit(1)
}

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

console.log(`sync: ${ROOT} -> ${target}`)

let copied = 0
const failed = []
for (const entry of SHIPPED) {
  const from = join(ROOT, entry)
  if (!existsSync(from)) { console.log('  skip (absent):', entry); continue }
  const to = join(target, entry)
  try {
    mkdirSync(dirname(to), { recursive: true })
    if (statSync(from).isDirectory()) {
      if (!checkOnly) cpSync(from, to, { recursive: true, force: true })
      copied += walk(from).length
    } else {
      if (!checkOnly) cpSync(from, to, { force: true })
      copied += 1
    }
  } catch (error) {
    failed.push(entry + ': ' + error.code)
  }
}

if (checkOnly) {
  console.log(`sync: --check only; ${copied} files would be written`)
  process.exit(0)
}

console.log(`sync: wrote ${copied} files`)
if (failed.length > 0) {
  console.error('sync: these entries failed and may be locked by a running app:')
  for (const line of failed) console.error('  ' + line)
  process.exit(1)
}
console.log('sync: restart the profile (or reload the desktop app) to pick up the change')
