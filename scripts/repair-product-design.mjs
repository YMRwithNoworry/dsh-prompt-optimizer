#!/usr/bin/env node
/**
 * Repair `dsh-plugin-product-design` in a DSH profile.
 *
 * Why this exists: pnpm's atomic directory swap removes the old package before
 * renaming the new one in. If the target directory is held open — which happens
 * when the DSH desktop app is running, because it loads the package's skills —
 * the swap fails partway and leaves the package as an empty shell. `pnpm
 * install` then cannot repair itself: it hits the same lock, reports
 * `failed to remove existing directory ... prior to swap`, and gives up.
 *
 * The fix is to stop the app, let the pending delete complete, and copy the
 * package back in. This script does the copy and tells you what to do about the
 * lock.
 *
 * Usage:
 *   node scripts/repair-product-design.mjs [profileName]
 *
 * @module dsh-prompt-optimizer/scripts/repair-product-design
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-plugin-product-design'
const profile = process.argv[2] ?? 'desktop'
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const target = join(dshHome, 'profiles', profile, 'node_modules', PACKAGE)
const staged = join(dshHome, 'profiles', profile, '.repair-product-design-skills')

/**
 * Count the files under a directory, or -1 when it cannot be read.
 *
 * A directory left in delete-pending state by a failed swap still stats as a
 * directory but cannot be enumerated, so "readable with files in it" is the
 * only test that distinguishes a healthy package from a broken one.
 * @param dir - directory to walk.
 * @returns the file count, or -1 when unreadable.
 */
function countFiles(dir) {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nested = countFiles(join(dir, entry.name))
        if (nested < 0) return -1
        total += nested
      } else {
        total += 1
      }
    }
  } catch {
    return -1
  }
  return total
}

if (!existsSync(join(target, 'package.json'))) {
  console.error(`repair: ${PACKAGE} is missing or incomplete at ${target}`)
} else {
  console.log(`repair: ${PACKAGE} is present at ${target}`)
}

// The skills directory is the part that goes missing, because it is the part
// the running app holds open.
const skillCount = countFiles(join(target, 'skills'))
if (skillCount > 0) {
  console.log(`repair: skills are intact (${skillCount} files) — nothing to do`)
  process.exit(0)
}
if (skillCount < 0) {
  console.log('repair: the skills directory exists but cannot be read — a failed swap left it pending deletion.')
}

if (!existsSync(staged)) {
  console.error('repair: no staged copy found.')
  console.error('repair: stop the DSH desktop app, then run:')
  console.error(`repair:   dsh plugin --profile ${profile} add ${PACKAGE}`)
  process.exit(1)
}

const skills = join(target, 'skills')
try {
  if (existsSync(skills)) rmSync(skills, { recursive: true, force: true })
  mkdirSync(skills, { recursive: true })
  cpSync(staged, skills, { recursive: true })

  // Verify before cleaning up: a copy that half-succeeded must not delete the
  // only good copy.
  const restored = countFiles(skills)
  const expected = countFiles(staged)
  if (restored !== expected) {
    console.error(`repair: restored ${restored} of ${expected} files — the staged copy is kept at ${staged}`)
    process.exit(1)
  }
  rmSync(staged, { recursive: true, force: true })
  console.log(`repair: restored ${restored} skill files into ${skills}`)
  console.log('repair: done')
} catch (error) {
  console.error('repair: still locked (' + error.code + ') — the DSH app is holding the directory.')
  console.error('repair: quit the DSH desktop app completely, then run this again.')
  console.error('repair: the staged copy is safe at ' + staged)
  process.exit(1)
}
