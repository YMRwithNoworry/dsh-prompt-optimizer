/**
 * Conversation context: trim the session's recent turns down to what can
 * actually resolve a reference.
 *
 * The optimizer only needs history to answer "what does 'that thing' mean?".
 * It never needs the whole transcript, and copying one in would both blow the
 * token budget and tempt the model into rewriting the conversation instead of
 * the draft.
 *
 * @module dsh-prompt-optimizer/context/conversation
 */
/** Maximum turns retained. */
const MAX_TURNS = 6;
/** Maximum characters per turn. */
const MAX_TURN_CHARS = 1200;
/** Total character cap across all retained turns. */
const MAX_TOTAL_CHARS = 4000;
/**
 * Keep the most recent turns, newest-last, within budget.
 *
 * The tail is kept rather than the head because a pronoun refers to what was
 * said immediately before the draft, not to the start of the session.
 *
 * @param raw - turns as received from the client.
 * @returns trimmed turns, oldest first.
 */
export function trimConversation(raw) {
    if (!Array.isArray(raw))
        return [];
    const turns = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null)
            continue;
        const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : undefined;
        if (role === undefined)
            continue;
        const text = typeof entry.text === 'string' ? entry.text.trim() : '';
        if (text.length === 0)
            continue;
        turns.push({ role, text: text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text });
    }
    // Walk backwards accumulating until the budget is spent, then restore order.
    const kept = [];
    let total = 0;
    for (let index = turns.length - 1; index >= 0 && kept.length < MAX_TURNS; index -= 1) {
        const turn = turns[index];
        if (total + turn.text.length > MAX_TOTAL_CHARS)
            break;
        kept.unshift(turn);
        total += turn.text.length;
    }
    return kept;
}
