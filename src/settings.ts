/**
 * Plugin settings: defaults, normalization, and the model-route parser.
 *
 * Settings live in one JSON file under `$DSH_HOME/prompt-optimizer.json`. The
 * plugin deliberately does not touch `settings.yaml`: that file belongs to the
 * profile's own configuration, and a plugin that rewrites it can break a
 * deployment it does not own. One file, one owner.
 *
 * @module dsh-prompt-optimizer/settings
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { Intensity, LanguageMode, OptimizerSettings } from './shared/types.ts'

/** The settings every fresh install starts from. */
export const DEFAULT_SETTINGS: OptimizerSettings = {
  // "current" reuses whatever model the session is already talking to, so the
  // plugin never forces the user to configure a second credential.
  model: 'current',
  intensity: 'balanced',
  language: 'auto',
  autoDetectDomain: true,
  showPreview: true,
  useConversationContext: true,
  useProjectContext: true,
  minecraftOptimization: true,
  enableVisionContext: true,
  customInstructions: '',
}

const INTENSITIES: readonly Intensity[] = ['light', 'balanced', 'deep']
const LANGUAGES: readonly LanguageMode[] = ['auto', 'chinese', 'english', 'original']

/** Coerce an untrusted value to a boolean, defaulting when absent. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Coerce an untrusted value to a string, defaulting when absent. */
function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Cap a string at a UTF-16 length, preserving the head. */
function cap(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

/**
 * Normalize an untrusted settings object into a complete, valid one.
 *
 * Every field falls back independently, so a corrupt or partial file degrades
 * to defaults field by field instead of discarding the whole configuration.
 *
 * @param raw - parsed JSON, or anything else.
 * @returns complete valid settings.
 */
export function normalizeSettings(raw: unknown): OptimizerSettings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const intensity = str(value.intensity, DEFAULT_SETTINGS.intensity) as Intensity
  const language = str(value.language, DEFAULT_SETTINGS.language) as LanguageMode
  return {
    model: cap(str(value.model, DEFAULT_SETTINGS.model).trim(), 200) || 'current',
    intensity: INTENSITIES.includes(intensity) ? intensity : DEFAULT_SETTINGS.intensity,
    language: LANGUAGES.includes(language) ? language : DEFAULT_SETTINGS.language,
    autoDetectDomain: bool(value.autoDetectDomain, DEFAULT_SETTINGS.autoDetectDomain),
    showPreview: bool(value.showPreview, DEFAULT_SETTINGS.showPreview),
    useConversationContext: bool(value.useConversationContext, DEFAULT_SETTINGS.useConversationContext),
    useProjectContext: bool(value.useProjectContext, DEFAULT_SETTINGS.useProjectContext),
    minecraftOptimization: bool(value.minecraftOptimization, DEFAULT_SETTINGS.minecraftOptimization),
    enableVisionContext: bool(value.enableVisionContext, DEFAULT_SETTINGS.enableVisionContext),
    customInstructions: cap(str(value.customInstructions, DEFAULT_SETTINGS.customInstructions), 8000),
  }
}

/** A parsed model route. */
export interface ModelRoute {
  provider: string
  model: string
}

/**
 * Parse the `model` setting.
 *
 * Accepted forms:
 *   - `current` — reuse the session's own model (the default)
 *   - `provider/model` — an explicit route
 *
 * @param setting - the raw setting value.
 * @returns the explicit route, or undefined to mean "follow the session".
 */
export function parseModelRoute(setting: string): ModelRoute | undefined {
  const trimmed = setting.trim()
  if (trimmed.length === 0 || trimmed === 'current') return undefined
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return undefined
  return { provider: trimmed.slice(0, separator), model: trimmed.slice(separator + 1) }
}

/** Resolve `$DSH_HOME`, honoring an explicit override. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
  return join(homedir(), '.dsh')
}

/** Absolute path of the plugin's settings file. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDshHome(env), 'prompt-optimizer.json')
}

/** Read settings from disk, returning defaults when the file is absent or broken. */
export function readSettings(path: string = settingsPath()): OptimizerSettings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Persist settings atomically.
 *
 * Writes to a sibling temp file and renames over the target, so an interrupted
 * write cannot leave a half-written settings file behind.
 *
 * @param next - settings to persist.
 * @param path - target path.
 * @returns the normalized settings that were written.
 */
export function writeSettings(next: OptimizerSettings, path: string = settingsPath()): OptimizerSettings {
  const normalized = normalizeSettings(next)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* the temp file may never have existed */ }
    throw error
  }
  return normalized
}
