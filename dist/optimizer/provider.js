/**
 * The bridge between this plugin and DSH's existing LLM stack.
 *
 * The plugin never reads an API key, never builds an HTTP client, and never
 * asks the user to configure a second provider. It resolves a provider/model
 * route the way the rest of the harness does and hands the request to
 * `ctx.llm.stream`, so authentication, retries, proxying, and adapter
 * behaviour are exactly the ones the session already uses.
 *
 * The `llm` service is reached structurally rather than by importing
 * `@deepseek-ai/dsh-llm`: the plugin only ever calls `stream` and builds one
 * plain user message, and avoiding the import keeps this module testable
 * outside a running harness.
 *
 * @module dsh-prompt-optimizer/optimizer/provider
 */
import { ChunkAssembler } from "./assembler.js";
/** Why an optimization call could not produce text. */
export class OptimizeError extends Error {
    /** Stable machine code the browser panel maps to localized copy. */
    code;
    /**
     * @param code - stable machine code.
     * @param message - technical detail for logs.
     */
    constructor(code, message) {
        super(message);
        this.name = 'OptimizeError';
        this.code = code;
    }
}
/**
 * Resolve which provider/model to call.
 *
 * Order of preference:
 *   1. The explicit `provider/model` from settings.
 *   2. The model the session is already using, supplied by the caller.
 *   3. The harness-wide default model.
 *
 * The session's own model wins over the harness default because a user who
 * switched model for this conversation expects the optimizer to follow.
 *
 * @param ctx - plugin context exposing the LLM and default-model services.
 * @param explicit - route parsed from settings, if any.
 * @param sessionRoute - the calling session's current route, if the client sent one.
 * @returns a usable route.
 * @throws OptimizeError `NO_ROUTE` when nothing can be resolved.
 */
export function resolveRoute(ctx, explicit, sessionRoute) {
    if (explicit !== undefined)
        return explicit;
    if (sessionRoute !== undefined && sessionRoute.provider.length > 0 && sessionRoute.model.length > 0) {
        return sessionRoute;
    }
    try {
        const selection = ctx.agentDefaultModel?.currentSelection();
        const provider = selection?.provider;
        const model = selection?.model;
        if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
            return { provider, model };
        }
    }
    catch (error) {
        ctx.logger?.warn(`prompt-optimizer: default model lookup failed: ${String(error)}`);
    }
    throw new OptimizeError('NO_ROUTE', 'no model route available: set an explicit provider/model in the Prompt Optimizer settings, or run inside a session with a selected model');
}
/**
 * Build the single user message the optimizer sends.
 *
 * Shaped to match the harness's own message representation so the adapter
 * projection accepts it unchanged.
 *
 * @param text - the framed draft.
 * @returns a user-role message with one text block.
 */
export function userMessage(text) {
    return {
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'dsh-prompt-optimizer' },
    };
}
/**
 * Run one non-streaming completion over DSH's streaming API.
 *
 * @param ctx - plugin context exposing `llm`.
 * @param route - provider/model to call.
 * @param system - the Prompt Architect system prompt.
 * @param user - the framed draft.
 * @param options - token ceiling, cancellation, and an optional reasoning effort.
 * @returns the assembled text.
 * @throws OptimizeError on an empty result, a tool call, truncation, or a provider failure.
 */
export async function complete(ctx, route, system, user, options) {
    const assembler = new ChunkAssembler();
    // The effort is forwarded only when one was actually chosen. Passing an empty
    // or unknown value would reject a route whose adapter exposes no efforts at
    // all, which is the common case.
    const effort = typeof options.reasoningEffort === 'string' && options.reasoningEffort.trim().length > 0
        ? options.reasoningEffort.trim()
        : undefined;
    try {
        for await (const chunk of ctx.llm.stream({
            provider: route.provider,
            model: route.model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
            messages: [userMessage(user)],
            system,
            maxTokens: options.maxTokens,
            // The architect must be predictable, not creative. A low temperature is
            // what keeps the same draft producing the same prompt.
            temperature: 0.2,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            purpose: 'session-title',
        })) {
            assembler.push(chunk);
        }
    }
    catch (error) {
        if (options.signal?.aborted === true)
            throw new OptimizeError('ABORTED', 'the request was cancelled');
        const message = error instanceof Error ? error.message : String(error);
        const code = typeof error?.code === 'string'
            ? String(error.code)
            : 'PROVIDER_ERROR';
        throw new OptimizeError(code, message);
    }
    const finish = assembler.finish;
    if (finish?.kind !== undefined && finish.kind !== 'stop') {
        if (finish.kind === 'aborted')
            throw new OptimizeError('ABORTED', 'the request was cancelled');
        if (finish.kind === 'error') {
            throw new OptimizeError(finish.failure?.code ?? 'PROVIDER_ERROR', finish.failure?.message ?? 'provider error');
        }
        if (finish.kind === 'max-tokens')
            throw new OptimizeError('TRUNCATED', 'the model hit the token ceiling');
        if (finish.kind === 'tool-calls')
            throw new OptimizeError('UNEXPECTED_TOOL_CALL', 'the model requested a tool');
    }
    if (assembler.hasToolCall()) {
        throw new OptimizeError('UNEXPECTED_TOOL_CALL', 'the model requested a tool');
    }
    const text = assembler.text().trim();
    if (text.length === 0)
        throw new OptimizeError('EMPTY_OUTPUT', 'the model returned no text');
    return { text, route };
}
