/**
 * Model discovery: enumerate the routes DSH already has configured.
 *
 * The plugin never keeps its own provider list. It asks the harness's LLM
 * service what it can talk to, and for each route asks what reasoning efforts
 * that exact model exposes. The settings panel then offers real choices
 * instead of asking the user to type a route string from memory.
 *
 * Everything here is best-effort. A composition without an LLM service, a
 * provider whose adapter is dormant, or an adapter that throws on model
 * listing all degrade to "no routes discovered" — the panel still works, and
 * `current` is always available as the first option.
 *
 * @module dsh-prompt-optimizer/optimizer/model-routes
 */
/** How long one provider's model listing may take before it is abandoned. */
const PROVIDER_TIMEOUT_MS = 4000;
/** Total wall-clock budget for one discovery pass. */
const TOTAL_TIMEOUT_MS = 12000;
/** Cap the routes offered, so one enormous provider cannot flood the panel. */
const MAX_ROUTES = 200;
/** Coerce an unknown to a non-empty trimmed string, or undefined. */
function text(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
/** Race one promise against a timeout, resolving undefined on expiry. */
async function withTimeout(promise, ms) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
        ]);
    }
    catch {
        return undefined;
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
/** Normalize the efforts an adapter advertises for one model. */
function normalizeEfforts(reasoning) {
    const source = (typeof reasoning === 'object' && reasoning !== null ? reasoning : {});
    const raw = Array.isArray(source.efforts) ? source.efforts : [];
    const efforts = [];
    for (const entry of raw) {
        const id = text(entry?.id);
        if (id === undefined)
            continue;
        const name = text(entry?.name) ?? id;
        const description = text(entry?.description);
        efforts.push({ id, name, ...(description === undefined ? {} : { description }) });
    }
    const defaultEffort = text(source.defaultEffort);
    return { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) };
}
/**
 * Enumerate every usable provider/model route with its reasoning efforts.
 *
 * @param llm - the harness LLM service, or undefined when the composition has none.
 * @param signal - caller cancellation.
 * @returns the discovered routes plus diagnostics for an empty result.
 */
export async function discoverModelRoutesDetailed(llm, signal) {
    if (llm === undefined || typeof llm.listProviders !== 'function') {
        return { routes: [], llmAvailable: false, providerCount: 0, failedProviders: [] };
    }
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const routes = [];
    const failedProviders = [];
    let providers = [];
    try {
        const listed = llm.listProviders();
        if (Array.isArray(listed))
            providers = listed;
    }
    catch {
        return { routes: [], llmAvailable: true, providerCount: 0, failedProviders: [] };
    }
    for (const provider of providers) {
        if (signal?.aborted === true)
            break;
        if (Date.now() >= deadline)
            break;
        if (routes.length >= MAX_ROUTES)
            break;
        const providerId = text(provider?.id);
        if (providerId === undefined)
            continue;
        const providerName = text(provider?.name) ?? providerId;
        if (typeof llm.listModels !== 'function')
            continue;
        const models = await withTimeout(llm.listModels(providerId), Math.min(PROVIDER_TIMEOUT_MS, Math.max(500, deadline - Date.now())));
        // Record the failure rather than hiding it: "the adapter advertises no
        // models" and "the adapter threw" need different fixes, and from the panel
        // they would otherwise look identical.
        if (!Array.isArray(models)) {
            failedProviders.push(providerId);
            continue;
        }
        for (const model of models) {
            if (routes.length >= MAX_ROUTES)
                break;
            const modelId = text(model?.id);
            if (modelId === undefined)
                continue;
            const modelName = text(model?.name) ?? modelId;
            // Effort metadata lives on the resolved route, not the catalog entry, so
            // it costs one extra adapter call per model. A failure here is not fatal:
            // the route is still offered, just without effort choices.
            let resolved;
            if (typeof llm.resolveModelInfo === 'function') {
                resolved = await withTimeout(llm.resolveModelInfo(providerId, modelId, signal), Math.min(PROVIDER_TIMEOUT_MS, Math.max(500, deadline - Date.now())));
            }
            const { efforts, defaultEffort } = normalizeEfforts(resolved?.reasoning);
            routes.push({
                provider: providerId,
                providerName,
                model: modelId,
                modelName,
                value: `${providerId}/${modelId}`,
                efforts,
                ...(defaultEffort === undefined ? {} : { defaultEffort }),
            });
        }
    }
    return { routes, llmAvailable: true, providerCount: providers.length, failedProviders };
}
/**
 * Enumerate every usable provider/model route.
 *
 * @param llm - the harness LLM service, or undefined when the composition has none.
 * @param signal - caller cancellation.
 * @returns the discovered routes in provider order, model order within each.
 */
export async function discoverModelRoutes(llm, signal) {
    return (await discoverModelRoutesDetailed(llm, signal)).routes;
}
