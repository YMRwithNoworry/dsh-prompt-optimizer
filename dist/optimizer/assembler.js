/**
 * A minimal chunk assembler for one auxiliary model call.
 *
 * DSH ships `BlockAssembler` for the agent loop, but importing it would tie
 * this plugin's pure logic to a harness package — which would make the
 * optimizer untestable outside a running DSH and would break every local
 * `node --test` run. This module implements exactly the subset an auxiliary
 * text-only call needs, and nothing else.
 *
 * Tolerances it keeps, matching the real assembler:
 *   - delta-only protocols that never emit `block-start`;
 *   - deltas for an index already closed by `block-end` are ignored;
 *   - `reasoning-delta` is accumulated separately and never returned as text,
 *     because a thinking model's reasoning is not the answer.
 *
 * @module dsh-prompt-optimizer/optimizer/assembler
 */
/** Accumulates chunks into text blocks and a terminal finish reason. */
export class ChunkAssembler {
    partials = new Map();
    order = [];
    finishReason;
    /** Feed one chunk. Unknown chunk types are ignored rather than throwing. */
    push(chunk) {
        if (chunk === null || chunk === undefined || typeof chunk !== 'object')
            return;
        switch (chunk.type) {
            case 'block-start': {
                this.ensure(chunk.index, chunk.blockType);
                return;
            }
            case 'text-delta': {
                const partial = this.ensure(chunk.index, 'text');
                if (!partial.closed)
                    partial.text += chunk.text ?? '';
                return;
            }
            case 'reasoning-delta': {
                const partial = this.ensure(chunk.index, 'reasoning');
                if (!partial.closed)
                    partial.text += chunk.text ?? '';
                return;
            }
            case 'tool-call-delta': {
                const partial = this.ensure(chunk.index, 'tool-call');
                if (!partial.closed) {
                    partial.text += chunk.argumentsDelta ?? '';
                    if (partial.name === undefined && typeof chunk.name === 'string')
                        partial.name = chunk.name;
                }
                return;
            }
            case 'block-end': {
                const partial = this.ensure(chunk.index, chunk.block?.type);
                partial.closed = true;
                if (typeof chunk.block?.text === 'string')
                    partial.final = chunk.block.text;
                return;
            }
            case 'finish': {
                this.finishReason = chunk.reason;
                return;
            }
            default:
                return;
        }
    }
    /** Resolve (or create) the partial for one index. */
    ensure(index, kind) {
        const existing = this.partials.get(index);
        if (existing !== undefined)
            return existing;
        const resolved = kind === 'reasoning'
            ? 'reasoning'
            : kind === 'tool-call'
                ? 'tool-call'
                : 'text';
        const created = { kind: resolved, text: '', closed: false };
        this.partials.set(index, created);
        this.order.push(index);
        return created;
    }
    /** The terminal finish reason, once a `finish` chunk has arrived. */
    get finish() {
        return this.finishReason;
    }
    /**
     * The assembled text, in stream order.
     *
     * Reasoning and tool-call blocks are excluded: a caller that asked for a
     * rewrite wants the rewrite.
     */
    text() {
        return this.order
            .map((index) => this.partials.get(index))
            .filter((partial) => partial !== undefined && partial.kind === 'text')
            .map((partial) => partial.final ?? partial.text)
            .join('');
    }
    /** Whether any tool-call block was seen. */
    hasToolCall() {
        return this.order.some((index) => this.partials.get(index)?.kind === 'tool-call');
    }
}
