/**
 * Shared vocabulary of the Prompt Optimizer.
 *
 * These types cross every boundary in the plugin: the browser composer reads
 * them, the host optimizer produces them, and the settings panel persists
 * them. Nothing here imports a runtime, so both halves can depend on it.
 *
 * @module dsh-prompt-optimizer/shared/types
 */

/** How hard the optimizer is allowed to rewrite the user's draft. */
export type Intensity = 'light' | 'balanced' | 'deep'

/** Which language the optimized prompt is written in. */
export type LanguageMode = 'auto' | 'chinese' | 'english' | 'original'

/**
 * One optimization domain.
 *
 * A domain is a *strategy*, not a keyword list: it carries the checklist the
 * optimizer should think through, the failure modes it must avoid, and the
 * extra output sections that domain genuinely needs. Adding a domain is adding
 * one object to the registry — no prompt surgery anywhere else.
 */
export interface DomainStrategy {
  /** Stable registry key, e.g. `coding`. */
  id: string
  /** Human label shown in the preview panel and diagnostics. */
  label: string
  /** One-line description of when this strategy applies. */
  when: string
  /** Lowercased substrings that suggest this domain. Scored, never authoritative. */
  signals: readonly string[]
  /**
   * Dimensions the optimizer should consider for this domain, phrased as the
   * question it answers. These are *considerations*, not requirements: the
   * system prompt tells the model to drop any that the user's intent does not
   * support.
   */
  considerations: readonly string[]
  /**
   * Sections this domain genuinely benefits from, beyond the universal ones.
   * Only used when the task is complex enough to earn the structure.
   */
  sections: readonly string[]
  /** Domain-specific anti-patterns the optimizer must not drift into. */
  avoid: readonly string[]
}

/** The result of scoring one draft against the registry. */
export interface DomainMatch {
  /** The winning strategy. Always present — `general` is the fallback. */
  domain: DomainStrategy
  /** Every domain that scored above zero, best first. */
  ranked: readonly { id: string; label: string; score: number }[]
  /** Whether the detection was confident or merely defaulted. */
  confident: boolean
}

/** Task size, which decides how much structure the output earns. */
export type Complexity = 'trivial' | 'simple' | 'moderate' | 'complex'

/** A complexity verdict plus the evidence that produced it. */
export interface ComplexityVerdict {
  level: Complexity
  /** Human-readable reasons, surfaced in diagnostics. */
  reasons: readonly string[]
  /** Suggested character budget for the optimized prompt. */
  budget: number
}

/** What the optimizer decided before it called the model. */
export interface OptimizationPlan {
  domain: DomainMatch
  complexity: ComplexityVerdict
  intensity: Intensity
  language: LanguageMode
  /** Sections the plan expects the model to use, in order. */
  sections: readonly string[]
  /** True when the draft is already good enough to pass through unchanged. */
  noop: boolean
}

/** One persisted plugin setting. */
export interface OptimizerSettings {
  /** `current` reuses the session's model; otherwise `provider/model`. */
  model: string
  intensity: Intensity
  language: LanguageMode
  autoDetectDomain: boolean
  showPreview: boolean
  useConversationContext: boolean
  useProjectContext: boolean
  minecraftOptimization: boolean
  enableVisionContext: boolean
  /** User-authored rules folded into every optimization. */
  customInstructions: string
}

/** The wire payload the browser posts to the optimizer route. */
export interface OptimizeRequest {
  /** The raw composer draft. */
  text: string
  /** Client-generated id used to drop stale replies. */
  requestId: string
  /** Per-call overrides; anything absent falls back to stored settings. */
  intensity?: Intensity
  language?: LanguageMode
  /** Recent conversation turns, already trimmed by the client. */
  conversation?: readonly { role: 'user' | 'assistant'; text: string }[]
  /** Names of draft attachments the optimizer cannot read. */
  attachments?: readonly string[]
}

/** One successfully optimized prompt. */
export interface OptimizeResult {
  requestId: string
  /** The prompt the user should actually send. */
  optimized: string
  /** The original draft, echoed for the diff view. */
  original: string
  /** What the optimizer decided, for the panel's diagnostics line. */
  plan: {
    domainId: string
    domainLabel: string
    complexity: Complexity
    intensity: Intensity
    language: string
    noop: boolean
    ranked: readonly { id: string; label: string; score: number }[]
    sections: readonly string[]
    reasons: readonly string[]
  }
}

/** Every failure the optimizer can report, with copy the panel can show. */
export interface OptimizeFailure {
  requestId: string
  /** Stable machine code; the panel maps it to localized copy. */
  code: string
  /** Non-localized technical detail, for logs and the expanded error view. */
  detail: string
}
