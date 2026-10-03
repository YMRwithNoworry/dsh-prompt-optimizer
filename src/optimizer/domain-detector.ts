/**
 * Domain detection: score the draft against every registered strategy.
 *
 * Deliberately simple and inspectable. A deterministic scorer has three
 * advantages over asking the model to classify: it is free, it is testable,
 * and its verdict can be shown to the user as a reason rather than a claim.
 * The model still receives the ranked list and may overrule it — the detector
 * proposes, the prompt decides.
 *
 * @module dsh-prompt-optimizer/optimizer/domain-detector
 */

import type { DomainMatch } from '../shared/types.ts'
import { DOMAINS, domainById } from './domains/index.ts'

/**
 * Weights applied to one signal hit.
 *
 * A multi-word signal ("minecraft mod") is far more specific than a bare
 * fragment ("mc "), so it scores higher; a CJK signal is exact enough that it
 * needs no length bonus.
 */
function signalWeight(signal: string): number {
  const words = signal.trim().split(/\s+/).length
  if (words >= 2) return 3
  return 2
}

/**
 * Score one domain against a lowercased draft.
 *
 * Signals are counted once each — repeating "代码" five times does not make a
 * task five times more like coding, and letting it would let a long draft
 * swamp a precise short one.
 */
function scoreDomain(signals: readonly string[], haystack: string): number {
  let score = 0
  for (const signal of signals) {
    if (signal.length === 0) continue
    if (haystack.includes(signal)) score += signalWeight(signal)
  }
  return score
}

/** Case- and width-insensitive normalization for matching. */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKC')
}

/**
 * Detect the best-matching domain for one draft.
 *
 * @param text - the raw draft.
 * @param options - `minecraftOptimization: false` removes the Minecraft
 *   strategy from the registry, which is how a user who never touches
 *   Minecraft stops its signals from firing on unrelated prose.
 * @returns the winning strategy plus the ranked evidence.
 */
export function detectDomain(
  text: string,
  options: { minecraftOptimization?: boolean } = {},
): DomainMatch {
  const haystack = normalize(text)
  const candidates = options.minecraftOptimization === false
    ? DOMAINS.filter((domain) => domain.id !== 'minecraft')
    : DOMAINS

  const scored = candidates
    .filter((domain) => domain.signals.length > 0)
    .map((domain) => ({ id: domain.id, label: domain.label, score: scoreDomain(domain.signals, haystack) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  // The general strategy is the fallback, never a competitor.
  const winner = scored[0]
  if (winner === undefined) {
    return { domain: domainById('general'), ranked: [], confident: false }
  }
  return {
    domain: domainById(winner.id),
    ranked: scored,
    // A single weak hit is a guess; two or more points is evidence.
    confident: winner.score >= 2,
  }
}
