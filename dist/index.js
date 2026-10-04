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
import { discoverModelRoutesDetailed } from "./optimizer/model-routes.js";
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
 * Resolve the optional services this plugin can use.
 *
 * Cordis only exposes a service to a fiber that declared it in `inject`; a
 * plain `ctx.llm` read from a fiber with an empty declaration returns
 * undefined. Declaring them in `inject` is not an option either — that makes
 * them *required*, and the plugin would wait forever in a profile that mounts
 * no model or no web server.
 *
 * `ctx.inject([...])` is the supported middle ground: it resolves each service
 * when it becomes available and never blocks the plugin on one that does not.
 *
 * @param ctx - plugin context.
 * @returns a live view of whichever services resolved.
 */
function resolveServices(ctx) {
    const services = {};
    for (const name of ['webServer', 'llm', 'agentDefaultModel']) {
        try {
            ctx.inject?.([name], (scoped) => { services[name] = scoped[name]; });
        }
        catch {
            // A service this composition does not mount is simply absent.
        }
    }
    return services;
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
    // Resolving the services is what makes them readable at all; see
    // `resolveServices`. Reads go through this view, never through `ctx` direct.
    const services = resolveServices(ctx);
    /**
     * The context handed to the optimizer and the route handlers.
     *
     * Rebuilt per call so a service that resolves after this plugin started — the
     * LLM service mounts on its own schedule — is picked up without a restart.
     */
    const liveContext = () => ({
        llm: services.llm,
        agentDefaultModel: services.agentDefaultModel,
        logger: ctx.logger,
    });
    ctx.inject?.(['webServer'], (host) => {
        host.effect(() => host.webServer.register({
            // A prefix route keeps every path this plugin owns inside one namespace,
            // so it can never shadow a core route.
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: createRouteHandler({
                ctx: liveContext(),
                getSettings,
                setSettings,
                listRoutes: () => discoverModelRoutesDetailed(services.llm),
            }),
        }), 'dsh-prompt-optimizer: routes');
    });
    try {
        const settings = getSettings();
        ctx.logger?.info(`dsh-prompt-optimizer: active — model ${settings.model}, intensity ${settings.intensity}, `
            + `language ${settings.language}, domain detection ${settings.autoDetectDomain ? 'on' : 'off'}`);
        // `llm` resolves on its own schedule, so the provider count is reported a
        // moment later rather than racing the plugin's own startup line.
        ctx.inject?.(['llm'], (scoped) => {
            try {
                const listed = scoped.llm?.listProviders?.();
                const count = Array.isArray(listed) ? listed.length : 0;
                ctx.logger?.info(`dsh-prompt-optimizer: llm available — ${count} provider route(s)`);
            }
            catch {
                // Logging is best-effort.
            }
        });
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
