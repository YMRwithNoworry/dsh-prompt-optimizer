/**
 * Project context: read the workspace's own rules, and only those.
 *
 * The hard rule this module enforces is that the optimizer must never become a
 * way to upload a repository to a model. It reads a fixed allowlist of
 * rule-bearing filenames, at most one directory deep, with a byte cap per file
 * and a cap on the total. Source code is never read.
 *
 * @module dsh-prompt-optimizer/context/project
 */

import { readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Filenames the optimizer will read, in priority order.
 *
 * All of these are *declarative* files — they state rules, not implementation.
 * That is what makes reading them safe and useful.
 */
export const RULE_FILES: readonly string[] = [
  'AGENTS.md',
  'PROMPT_RULES.md',
  '.prompt-rules',
  'DESIGN.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'README.md',
]

/** Per-file byte cap. Beyond this the file is truncated at a line boundary. */
const MAX_FILE_BYTES = 16 * 1024

/** Total byte cap across all files. */
const MAX_TOTAL_BYTES = 32 * 1024

/** One rule file that was read. */
export interface RuleFile {
  file: string
  text: string
}

/**
 * Read the project's rule files from a working directory.
 *
 * Failure is always silent and partial: an unreadable file is skipped rather
 * than failing the optimization. Context is a bonus, never a precondition.
 *
 * @param cwd - absolute directory of the session's workspace.
 * @returns the files that were read, in allowlist order.
 */
export function readProjectRules(cwd: string | undefined): RuleFile[] {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) return []

  const results: RuleFile[] = []
  let total = 0

  for (const name of RULE_FILES) {
    if (total >= MAX_TOTAL_BYTES) break
    const path = join(cwd, name)
    try {
      if (!existsSync(path)) continue
      const stat = statSync(path)
      if (!stat.isFile()) continue
      const raw = readFileSync(path, 'utf8')
      // A file that is mostly binary or generated content is not a rule file.
      if (raw.includes('\u0000')) continue
      const capped = raw.length > MAX_FILE_BYTES
        ? `${raw.slice(0, MAX_FILE_BYTES)}\n[... truncated at ${MAX_FILE_BYTES} characters ...]`
        : raw
      const remaining = MAX_TOTAL_BYTES - total
      const text = capped.length > remaining ? capped.slice(0, remaining) : capped
      if (text.trim().length === 0) continue
      results.push({ file: name, text })
      total += text.length
    } catch {
      // An unreadable rule file never fails an optimization.
    }
  }

  return results
}
