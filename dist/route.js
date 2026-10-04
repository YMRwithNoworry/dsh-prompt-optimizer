/**
 * The browser-facing HTTP surface of the plugin.
 *
 * Three routes, all under one prefix the plugin owns:
 *
 *   GET  /prompt-optimizer/settings  -> stored settings + resolved model list
 *   POST /prompt-optimizer/settings  -> persist settings
 *   POST /prompt-optimizer/optimize  -> run one optimization
 *
 * The plugin talks to its host half over HTTP rather than a remote service
 * because that is the extension point DSH exposes to third-party packages: the
 * web server's route table. No core service is patched, and nothing is
 * intercepted.
 *
 * Every POST is origin-checked. A browser always sends `Origin` on a POST, so
 * a mismatched origin is a cross-site write; the desktop shell relays the page
 * request and strips `Origin`, which is why its absence is accepted.
 *
 * @module dsh-prompt-optimizer/route
 */
import { DEFAULT_SETTINGS, normalizeSettings, parseModelRoute, readSettings, writeSettings } from "./settings.js";
import { optimize } from "./optimizer/optimizer.js";
import { OptimizeError } from "./optimizer/provider.js";
import { trimConversation } from "./context/conversation.js";
import { readProjectRules } from "./context/project.js";
/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/prompt-optimizer';
/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 512 * 1024;
/** Scheme the Desktop shell serves its page from. */
const DESKTOP_ORIGIN_PROTOCOL = 'dsh-app:';
/**
 * Write one JSON response.
 * @param response - platform response object.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
export function sendJson(response, status, payload) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(payload));
}
/**
 * Whether a POST may proceed.
 *
 * A missing `Origin` is accepted: the desktop shell relays requests and strips
 * it, and a native client on this machine can already write the settings file
 * directly. A present `Origin` must agree with `Host`.
 *
 * @param request - platform request object.
 * @returns true when the request may write.
 */
export function sameOrigin(request) {
    const origin = request.headers?.origin;
    if (origin === undefined || origin === '')
        return true;
    const host = request.headers?.host;
    if (host === undefined)
        return false;
    try {
        const url = new URL(origin);
        if (url.protocol === DESKTOP_ORIGIN_PROTOCOL)
            return true;
        return url.host === host;
    }
    catch {
        return false;
    }
}
/**
 * Read and parse a JSON body, capped before buffering.
 * @param request - platform request object.
 * @returns the parsed body.
 * @throws Error when the body is too large or is not valid JSON.
 */
export async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text.trim().length === 0 ? {} : JSON.parse(text);
}
/**
 * Build the settings response body.
 * @param deps - route dependencies.
 * @returns the payload the settings panel renders.
 */
async function settingsPayload(deps) {
    // Discovery is best-effort: a composition without an LLM service, or an
    // adapter that fails to enumerate, must still produce a usable panel.
    let discovery = { routes: [], llmAvailable: false, providerCount: 0, failedProviders: [] };
    try {
        discovery = await deps.listRoutes();
    }
    catch {
        discovery = { routes: [], llmAvailable: false, providerCount: 0, failedProviders: [] };
    }
    return {
        settings: deps.getSettings(),
        defaults: DEFAULT_SETTINGS,
        routes: discovery.routes,
        // Enough context for the panel to explain an empty list instead of just
        // showing nothing.
        discovery: {
            llmAvailable: discovery.llmAvailable,
            providerCount: discovery.providerCount,
            failedProviders: discovery.failedProviders,
        },
        // The parser's verdict, so the panel can show whether the stored route is usable.
        explicitRoute: parseModelRoute(deps.getSettings().model) ?? null,
    };
}
/**
 * Run one optimization request.
 * @param deps - route dependencies.
 * @param body - the parsed request body.
 * @returns the result or failure payload.
 */
async function runOptimize(deps, body) {
    const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
    const text = typeof body?.text === 'string' ? body.text : '';
    if (text.trim().length === 0) {
        return { status: 200, payload: { requestId, code: 'EMPTY_DRAFT', detail: 'the draft is empty' } };
    }
    const settings = deps.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
        const outcome = await optimize(deps.ctx, {
            text,
            settings,
            ...(body.intensity === undefined ? {} : { intensity: body.intensity }),
            ...(body.language === undefined ? {} : { language: body.language }),
            ...(settings.useConversationContext ? { conversation: trimConversation(body.conversation) } : {}),
            ...(Array.isArray(body.attachments) && body.attachments.length > 0
                ? { attachments: body.attachments.filter((name) => typeof name === 'string').slice(0, 20) }
                : {}),
            ...(settings.useProjectContext
                ? { projectRules: readProjectRules(typeof body.cwd === 'string' ? String(body.cwd) : undefined) }
                : {}),
            signal: controller.signal,
        });
        return {
            status: 200,
            payload: {
                requestId,
                optimized: outcome.optimized,
                original: outcome.original,
                plan: {
                    domainId: outcome.plan.domain.domain.id,
                    domainLabel: outcome.plan.domain.domain.label,
                    complexity: outcome.plan.complexity.level,
                    intensity: outcome.plan.intensity,
                    language: outcome.plan.language,
                    noop: outcome.plan.noop,
                    ranked: outcome.plan.domain.ranked,
                    sections: outcome.plan.sections,
                    reasons: outcome.plan.complexity.reasons,
                },
            },
        };
    }
    catch (error) {
        if (error instanceof OptimizeError) {
            return { status: 200, payload: { requestId, code: error.code, detail: error.message } };
        }
        const detail = error instanceof Error ? error.message : String(error);
        return { status: 200, payload: { requestId, code: 'UNKNOWN', detail } };
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Build the route handler mounted on the profile's web server.
 * @param deps - route dependencies.
 * @returns an async (request, response) handler.
 */
export function createRouteHandler(deps) {
    return async (request, response) => {
        const rawUrl = typeof request.url === 'string' ? request.url : '/';
        const path = rawUrl.split('?')[0];
        const method = request.method ?? 'GET';
        try {
            if (path === `${ROUTE_PREFIX}/settings`) {
                if (method === 'GET') {
                    sendJson(response, 200, await settingsPayload(deps));
                    return;
                }
                if (method === 'POST') {
                    if (!sameOrigin(request)) {
                        response.writeHead(403);
                        response.end();
                        return;
                    }
                    const body = await readJsonBody(request);
                    const next = normalizeSettings(body?.settings);
                    const saved = deps.setSettings(next);
                    const payload = await settingsPayload(deps);
                    sendJson(response, 200, { ...payload, ok: true, settings: saved });
                    return;
                }
                response.writeHead(405, { allow: 'GET, POST' });
                response.end();
                return;
            }
            if (path === `${ROUTE_PREFIX}/optimize`) {
                if (method !== 'POST') {
                    response.writeHead(405, { allow: 'POST' });
                    response.end();
                    return;
                }
                if (!sameOrigin(request)) {
                    response.writeHead(403);
                    response.end();
                    return;
                }
                const body = await readJsonBody(request);
                const { status, payload } = await runOptimize(deps, body);
                sendJson(response, status, payload);
                return;
            }
            if (path === `${ROUTE_PREFIX}/health`) {
                // Deliberately does no discovery: a liveness probe must stay cheap.
                sendJson(response, 200, { ok: true, settings: deps.getSettings() });
                return;
            }
            response.writeHead(404);
            response.end();
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            sendJson(response, 500, { code: 'ROUTE_ERROR', detail });
        }
    };
}
export { readSettings, writeSettings };
