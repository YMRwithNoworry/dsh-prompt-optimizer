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
import { DEFAULT_SETTINGS, normalizeSettings, parseModelRoute, readSettings, writeSettings } from "./settings.js";
import { ROUTE_PREFIX, createRouteHandler } from "./route.js";
// A plain-JS module: see its header for why it is not TypeScript.
import { buildConfigSchema, loadConfigSchema } from './config.js';
export { ROUTE_PREFIX };
export { DEFAULT_SETTINGS, normalizeSettings, parseModelRoute, readSettings, writeSettings };
export { createRouteHandler, buildConfigSchema, loadConfigSchema };
export * from "./shared/types.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'prompt-optimizer';
/**
 * Required services.
 *
 * Deliberately empty. Cordis treats every name here as a service the plugin
 * cannot start without — a hard dependency on `llm` or `webServer` would leave
 * this plugin pending forever in a profile that mounts no model or no web
 * server. Both are reached through `ctx.inject([...])` inside {@link apply}
 * instead, which is what makes them genuinely optional.
 */
export const inject = [];
/**
 * List provider/model routes for the settings panel.
 *
 * Best-effort: a profile without a model directory simply offers `current`.
 *
 * @param ctx - plugin context.
 * @returns provider routes and their advertised models.
 */
function listRoutes(ctx) {
    try {
        const providers = ctx.llm?.listProviders?.();
        if (!Array.isArray(providers))
            return [];
        return providers
            .filter((entry) => typeof entry?.provider === 'string')
            .map((entry) => {
            const models = Array.isArray(entry.models)
                ? entry.models
                    .map((model) => (typeof model === 'string' ? model : model?.id ?? model?.model))
                    .filter((id) => typeof id === 'string' && id.length > 0)
                : [];
            return { provider: entry.provider, models };
        });
    }
    catch {
        return [];
    }
}
/**
 * Apply the host half.
 *
 * @param ctx - plugin context.
 * @param config - optional composition overrides for the initial settings.
 */
export function apply(ctx, config = {}) {
    // One settings object for the process, re-read lazily so an external edit is
    // picked up without a restart.
    let cached = Object.keys(config).length > 0
        ? writeSettings({ ...readSettings(), ...config })
        : undefined;
    const getSettings = () => {
        if (cached === undefined)
            cached = readSettings();
        return cached;
    };
    const setSettings = (next) => {
        cached = writeSettings(next);
        return cached;
    };
    ctx.inject?.(['webServer'], (host) => {
        host.effect(() => host.webServer.register({
            // A prefix route keeps every path this plugin owns inside one namespace,
            // so it can never shadow a core route.
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: createRouteHandler({ ctx, getSettings, setSettings, listRoutes: () => listRoutes(ctx) }),
        }), 'dsh-prompt-optimizer: routes');
    });
    try {
        const settings = getSettings();
        ctx.logger?.info(`dsh-prompt-optimizer: active — model ${settings.model}, intensity ${settings.intensity}, `
            + `language ${settings.language}, domain detection ${settings.autoDetectDomain ? 'on' : 'off'}`);
    }
    catch {
        // Logging is best-effort.
    }
}
const plugin = { name, inject, apply };
loadConfigSchema()
    .then((schema) => { if (schema !== undefined)
    plugin.Config = schema; })
    .catch(() => { });
export default plugin;
