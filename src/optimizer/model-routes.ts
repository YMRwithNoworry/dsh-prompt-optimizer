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

import type { ModelRouteOption, ReasoningEffortOption } from '../shared/types.ts'

/** The subset of the LLM service this module reads. */
export interface RouteSource {
  listProviders?(): readonly { id?: unknown; name?: unknown }[]
  listModels?(provider: string): Promise<readonly { id?: unknown; name?: unknown; description?: unknown }[]>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{
    reasoning?: {
      efforts?: readonly { id?: unknown; name?: unknown; description?: unknown }[]
      defaultEffort?: unknown
    }
  }>
}

/** How long one provider's model listing may take before it is abandoned. */
const PROVIDER_TIMEOUT_MS = 4000

/** Total wall-clock budget for one discovery pass. */
const TOTAL_TIMEOUT_MS = 12000

/** Cap the routes offered, so one enormous provider cannot flood the panel. */
const MAX_ROUTES = 200

/** Coerce an unknown to a non-empty trimmed string, or undefined. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Race one promise against a timeout, resolving undefined on expiry. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms) }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Normalize the efforts an adapter advertises for one model. */
function normalizeEfforts(reasoning: unknown): { efforts: ReasoningEffortOption[]; defaultEffort?: string } {
  const source = (typeof reasoning === 'object' && reasoning !== null ? reasoning : {}) as {
    efforts?: unknown
    defaultEffort?: unknown
  }
  const raw = Array.isArray(source.efforts) ? source.efforts : []
  const efforts: ReasoningEffortOption[] = []
  for (const entry of raw) {
    const id = text((entry as { id?: unknown })?.id)
    if (id === undefined) continue
    const name = text((entry as { name?: unknown })?.name) ?? id
    const description = text((entry as { description?: unknown })?.description)
    efforts.push({ id, name, ...(description === undefined ? {} : { description }) })
  }
  const defaultEffort = text(source.defaultEffort)
  return { efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) }
}

/**
 * Enumerate every usable provider/model route with its reasoning efforts.
 *
 * @param llm - the harness LLM service, or undefined when the composition has none.
 * @param signal - caller cancellation.
 * @returns the discovered routes in provider order, model order within each.
 */
/** What one discovery pass found, and why it found nothing. */
export interface DiscoveryResult {
  routes: ModelRouteOption[]
  /** Whether the harness LLM service resolved at all. */
  llmAvailable: boolean
  /**
   * How many provider routes the harness reported.
   *
   * Surfaced so an empty result is diagnosable from the settings panel: no
   * service, no providers, and providers with no models are three different
   * problems with three different fixes.
   */
  providerCount: number
  /** Providers whose listing threw or timed out. */
  failedProviders: string[]
}

/**
 * Enumerate every usable provider/model route with its reasoning efforts.
 *
 * @param llm - the harness LLM service, or undefined when the composition has none.
 * @param signal - caller cancellation.
 * @returns the discovered routes plus diagnostics for an empty result.
 */
export async function discoverModelRoutesDetailed(
  llm: RouteSource | undefined,
  signal?: AbortSignal,
): Promise<DiscoveryResult> {
  if (llm === undefined || typeof llm.listProviders !== 'function') {
    return { routes: [], llmAvailable: false, providerCount: 0, failedProviders: [] }
  }

  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  const routes: ModelRouteOption[] = []
  const failedProviders: string[] = []

  let providers: readonly { id?: unknown; name?: unknown }[] = []
  try {
    const listed = llm.listProviders()
    if (Array.isArray(listed)) providers = listed
  } catch {
    return { routes: [], llmAvailable: true, providerCount: 0, failedProviders: [] }
  }

  for (const provider of providers) {
    if (signal?.aborted === true) break
    if (Date.now() >= deadline) break
    if (routes.length >= MAX_ROUTES) break

    const providerId = text(provider?.id)
    if (providerId === undefined) continue
    const providerName = text(provider?.name) ?? providerId
    if (typeof llm.listModels !== 'function') continue

    const models = await withTimeout(
      llm.listModels(providerId),
      Math.min(PROVIDER_TIMEOUT_MS, Math.max(500, deadline - Date.now())),
    )
    // Record the failure rather than hiding it: "the adapter advertises no
    // models" and "the adapter threw" need different fixes, and from the panel
    // they would otherwise look identical.
    if (!Array.isArray(models)) { failedProviders.push(providerId); continue }

    for (const model of models) {
      if (routes.length >= MAX_ROUTES) break
      const modelId = text(model?.id)
      if (modelId === undefined) continue
      const modelName = text(model?.name) ?? modelId

      // Effort metadata lives on the resolved route, not the catalog entry, so
      // it costs one extra adapter call per model. A failure here is not fatal:
      // the route is still offered, just without effort choices.
      let resolved: Awaited<ReturnType<NonNullable<RouteSource['resolveModelInfo']>>> | undefined
      if (typeof llm.resolveModelInfo === 'function') {
        resolved = await withTimeout(
          llm.resolveModelInfo(providerId, modelId, signal),
          Math.min(PROVIDER_TIMEOUT_MS, Math.max(500, deadline - Date.now())),
        )
      }
      const { efforts, defaultEffort } = normalizeEfforts(resolved?.reasoning)

      routes.push({
        provider: providerId,
        providerName,
        model: modelId,
        modelName,
        value: `${providerId}/${modelId}`,
        efforts,
        ...(defaultEffort === undefined ? {} : { defaultEffort }),
      })
    }
  }

  return { routes, llmAvailable: true, providerCount: providers.length, failedProviders }
}

/**
 * Enumerate every usable provider/model route.
 *
 * @param llm - the harness LLM service, or undefined when the composition has none.
 * @param signal - caller cancellation.
 * @returns the discovered routes in provider order, model order within each.
 */
export async function discoverModelRoutes(llm: RouteSource | undefined, signal?: AbortSignal): Promise<ModelRouteOption[]> {
  return (await discoverModelRoutesDetailed(llm, signal)).routes
}
