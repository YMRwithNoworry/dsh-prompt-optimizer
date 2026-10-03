/**
 * dsh-prompt-optimizer — host half.
 *
 * Mounts the plugin's HTTP surface on the profile's web server and owns the
 * settings file. Everything the plugin actually *does* lives in the optimizer
 * modules; this file is only wiring, so it stays short enough to audit.
 *
 * The plugin injects nothing mandatory: a profile without a web server simply
 * gets no routes, and the harness still boots.
 *
 * @module dsh-prompt-optimizer
 */

import type { OptimizerSettings } from './shared/types.ts'
import { DEFAULT_SETTINGS, normalizeSettings, parseModelRoute, readSettings, writeSettings } from './settings.ts'
import { ROUTE_PREFIX, createRouteHandler } from './route.ts'
// A plain-JS module: see its header for why it is not TypeScript.
import { buildConfigSchema, loadConfigSchema } from './config.js'

export { ROUTE_PREFIX }
export { DEFAULT_SETTINGS, normalizeSettings, parseModelRoute, readSettings, writeSettings }
export { createRouteHandler, buildConfigSchema, loadConfigSchema }
export * from './shared/types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'prompt-optimizer'

/**
 * Required services.
 *
 * Deliberately empty. Cordis treats every name here as a service the plugin
 * cannot start without — a hard dependency on `llm` or `webServer` would leave
 * this plugin pending forever in a profile that mounts no model or no web
 * server. Both are reached through `ctx.inject([...])` inside {@link apply}
 * instead, which is what makes them genuinely optional.
 */
export const inject: string[] = []

/**
 * List provider/model routes for the settings panel.
 *
 * Best-effort: a profile without a model directory simply offers `current`.
 *
 * @param ctx - plugin context.
 * @returns provider routes and their advertised models.
 */
function listRoutes(ctx: any): { provider: string; models: string[] }[] {
  try {
    const providers = ctx.llm?.listProviders?.()
    if (!Array.isArray(providers)) return []
    return providers
      .filter((entry: any) => typeof entry?.provider === 'string')
      .map((entry: any) => {
        const models: string[] = Array.isArray(entry.models)
          ? entry.models
              .map((model: any) => (typeof model === 'string' ? model : model?.id ?? model?.model))
              .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
          : []
        return { provider: entry.provider as string, models }
      })
  } catch {
    return []
  }
}

/**
 * Apply the host half.
 *
 * @param ctx - plugin context.
 * @param config - optional composition overrides for the initial settings.
 */
export function apply(ctx: any, config: Partial<OptimizerSettings> = {}): void {
  // One settings object for the process, re-read lazily so an external edit is
  // picked up without a restart.
  let cached: OptimizerSettings | undefined = Object.keys(config).length > 0
    ? writeSettings({ ...readSettings(), ...config })
    : undefined

  const getSettings = (): OptimizerSettings => {
    if (cached === undefined) cached = readSettings()
    return cached
  }
  const setSettings = (next: OptimizerSettings): OptimizerSettings => {
    cached = writeSettings(next)
    return cached
  }

  ctx.inject?.(['webServer'], (host: any) => {
    host.effect(() => host.webServer.register({
      // A prefix route keeps every path this plugin owns inside one namespace,
      // so it can never shadow a core route.
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createRouteHandler({ ctx, getSettings, setSettings, listRoutes: () => listRoutes(ctx) }),
    }), 'dsh-prompt-optimizer: routes')
  })

  try {
    const settings = getSettings()
    ctx.logger?.info(
      `dsh-prompt-optimizer: active — model ${settings.model}, intensity ${settings.intensity}, `
      + `language ${settings.language}, domain detection ${settings.autoDetectDomain ? 'on' : 'off'}`,
    )
  } catch {
    // Logging is best-effort.
  }
}

/**
 * The plugin face the harness reads.
 *
 * `inject` is declared optional rather than required: a hard dependency on
 * `llm` would leave the whole plugin pending in a profile that mounts no model,
 * and the settings route and the optimizer both degrade gracefully without one.
 *
 * `Config` is populated asynchronously because schemastery may not be
 * resolvable at import time. A profile whose settings page reads `Config` before
 * the swap lands simply shows no auto-generated form for this plugin; the
 * plugin's own settings section and its JSON file both keep working either way.
 */
interface PluginFace {
  name: string
  inject: typeof inject
  apply: typeof apply
  Config?: unknown
}

const plugin: PluginFace = { name, inject, apply }

loadConfigSchema()
  .then((schema: unknown) => { if (schema !== undefined) plugin.Config = schema })
  .catch(() => {})

export default plugin
