/**
 * Complexity verdict: how much structure does this draft actually earn?
 *
 * This module is the plugin's main defence against its own failure mode —
 * turning "你好" into a nine-section specification. It measures the *work* the
 * request implies, not its length, and returns a character budget the system
 * prompt uses as a hard ceiling.
 *
 * @module dsh-prompt-optimizer/optimizer/complexity
 */
/** Signals that a request is a greeting, acknowledgement, or trivial lookup. */
const TRIVIAL_PATTERNS = [
    /^\s*(你好|您好|hi|hello|hey|嗨|在吗|早|晚上好)\s*[!！。.~]*\s*$/i,
    /^\s*(谢谢|多谢|感谢|thanks|thank you|thx|3q)\s*[!！。.~]*\s*$/i,
    /^\s*(好的|ok|okay|收到|明白|懂了|嗯|行|可以)\s*[!！。.~]*\s*$/i,
    /^\s*(继续|continue|go on|接着)\s*[!！。.~]*\s*$/i,
];
/** Words that mark a request as an open-ended build rather than a small edit. */
const SCOPE_WORDS = [
    '完整', '全套', '系统', '平台', '框架', '架构', '从零', '从0', '端到端', '一体化',
    'complete', 'full', 'entire', 'system', 'platform', 'framework', 'architecture',
    'from scratch', 'end-to-end', 'suite', 'pipeline',
];
/** Words that mark an explicit multi-part deliverable. */
const MULTI_PART_WORDS = [
    '并且', '同时', '以及', '还要', '另外', '支持', '包括', '模块', '组件',
    'and also', 'as well as', 'plus', 'including', 'module', 'support for', 'multiple',
];
/** Verbs that request an action with a deliverable, rather than a question. */
const BUILD_VERBS = [
    '做', '实现', '开发', '写', '创建', '构建', '生成', '设计', '搭建', '重构', '迁移', '集成',
    'build', 'create', 'implement', 'develop', 'write', 'design', 'refactor', 'migrate', 'integrate', 'generate',
];
/** Count how many distinct entries of `list` appear in `text`. */
function countHits(list, text) {
    let hits = 0;
    for (const word of list)
        if (text.includes(word))
            hits += 1;
    return hits;
}
/**
 * Classify one draft.
 *
 * @param text - the raw draft.
 * @param domainId - the detected domain, which adjusts the budget: a design or
 *   research brief legitimately needs more room than a translation.
 * @returns the level, the reasons behind it, and a character budget.
 */
export function analyzeComplexity(text, domainId) {
    const trimmed = text.trim();
    const lowered = trimmed.toLowerCase();
    const reasons = [];
    // Greetings and acknowledgements never earn structure, whatever else is true.
    for (const pattern of TRIVIAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            reasons.push('greeting or acknowledgement');
            return { level: 'trivial', reasons, budget: 200 };
        }
    }
    const chars = trimmed.length;
    const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    const scope = countHits(SCOPE_WORDS, lowered);
    const multi = countHits(MULTI_PART_WORDS, lowered);
    const verbs = countHits(BUILD_VERBS, lowered);
    // Punctuation-separated clauses are a decent proxy for "how many things".
    const clauses = trimmed.split(/[，,。；;、.!！?？\n]/).filter((part) => part.trim().length > 0).length;
    let points = 0;
    if (chars > 60) {
        points += 1;
        reasons.push('draft is more than a phrase');
    }
    if (chars > 200) {
        points += 1;
        reasons.push('draft carries substantial detail');
    }
    if (chars > 500) {
        points += 1;
        reasons.push('draft is long enough to be a brief');
    }
    if (lines > 3) {
        points += 1;
        reasons.push('multiple requirement lines');
    }
    if (scope > 0) {
        points += 1;
        reasons.push(`scope words: ${scope}`);
    }
    if (scope > 1) {
        points += 1;
        reasons.push('several scope words');
    }
    if (multi > 0) {
        points += 1;
        reasons.push(`multi-part connectors: ${multi}`);
    }
    if (verbs > 0) {
        points += 1;
        reasons.push('explicit build verb');
    }
    if (clauses >= 4) {
        points += 1;
        reasons.push(`${clauses} distinct clauses`);
    }
    if (clauses >= 8) {
        points += 1;
        reasons.push('many distinct clauses');
    }
    let level;
    if (points <= 1)
        level = 'simple';
    else if (points <= 3)
        level = 'moderate';
    else
        level = 'complex';
    // Short drafts that still name a real deliverable sit at `simple`, not `trivial`.
    if (level === 'simple' && chars <= 12 && verbs === 0) {
        reasons.push('very short with no build verb');
    }
    // A design or research brief earns more room than a translation of the same length.
    const domainBonus = domainId === 'ui-design' || domainId === 'research' || domainId === 'coding'
        ? 1.25
        : 1;
    const base = { trivial: 200, simple: 600, moderate: 1800, complex: 4200 };
    return {
        level,
        reasons,
        budget: Math.round(base[level] * domainBonus),
    };
}
