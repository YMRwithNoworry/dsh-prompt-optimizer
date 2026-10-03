/**
 * The optimizer: plan, call, and post-process.
 *
 * Three responsibilities, kept separate on purpose:
 *
 *   1. {@link planOptimization} is pure and synchronous. It decides domain,
 *      complexity, intensity, language, and whether the draft is already good
 *      enough to pass through untouched. Being pure makes it fully testable
 *      without a model.
 *   2. {@link optimize} performs the model call through {@link complete}.
 *   3. {@link normalizeModelOutput} cleans the model's answer. Models
 *      occasionally wrap their result in a preamble or a code fence despite the
 *      contract; rather than trusting them, the wrapper is removed here.
 *
 * @module dsh-prompt-optimizer/optimizer/optimizer
 */

import type { ComplexityVerdict, DomainMatch, Intensity, LanguageMode, OptimizerSettings, OptimizationPlan } from '../shared/types.ts'
import { analyzeComplexity } from './complexity.ts'
import { detectDomain } from './domain-detector.ts'
import { buildSystemPrompt, buildUserMessage } from './system-prompt.ts'
import type { CompletionResult, LlmContext } from './provider.ts'
import { complete, resolveRoute } from './provider.ts'
import type { ModelRoute } from '../settings.ts'
import { parseModelRoute } from '../settings.ts'

/** Inputs the caller supplies for one optimization. */
export interface OptimizeInput {
  /** The raw composer draft. */
  text: string
  settings: OptimizerSettings
  /** Per-call intensity override. */
  intensity?: Intensity
  /** Per-call language override. */
  language?: LanguageMode
  /** Recent conversation turns. */
  conversation?: readonly { role: 'user' | 'assistant'; text: string }[]
  /** Names of attachments the optimizer cannot read. */
  attachments?: readonly string[]
  /** Project rule files already read by the caller. */
  projectRules?: readonly { file: string; text: string }[]
  /** The calling session's current model route, if known. */
  sessionRoute?: ModelRoute
  signal?: AbortSignal
}

/**
 * Decide everything except the actual rewrite.
 *
 * Pure: no I/O, no model, no clock. Every branch is unit-testable.
 *
 * @param input - the draft and the effective settings.
 * @returns the plan, including whether the optimizer should no-op.
 */
export function planOptimization(input: OptimizeInput): OptimizationPlan {
  const { text, settings } = input
  const trimmed = text.trim()

  const domain: DomainMatch = settings.autoDetectDomain
    ? detectDomain(trimmed, { minecraftOptimization: settings.minecraftOptimization })
    : detectDomain('', { minecraftOptimization: settings.minecraftOptimization })

  const complexity = analyzeComplexity(trimmed, domain.domain.id)
  const intensity = input.intensity ?? settings.intensity
  const language = input.language ?? settings.language

  // Sections: the domain's own sections, plus universal ones the complexity earns.
  const sections = new Set<string>()
  if (complexity.level === 'moderate') {
    sections.add('Objective')
    sections.add('Requirements')
  } else if (complexity.level === 'complex') {
    sections.add('Objective')
    sections.add('Requirements')
    sections.add('Acceptance Criteria')
    for (const section of domain.domain.sections) sections.add(section)
  }

  return {
    domain,
    complexity,
    intensity,
    language,
    sections: [...sections],
    noop: shouldNoop(trimmed, complexity, intensity),
  }
}

/**
 * Whether the draft should be returned unchanged.
 *
 * A no-op is a *correct* outcome, not a failure: rewriting "谢谢" produces a
 * worse prompt than leaving it alone, and the user can always press the button
 * again with a higher intensity.
 *
 * @param text - the trimmed draft.
 * @param complexity - the complexity verdict.
 * @param intensity - the requested intensity.
 * @returns true when the optimizer should hand back the original text.
 */
export function shouldNoop(text: string, complexity: ComplexityVerdict, intensity: Intensity): boolean {
  if (text.length === 0) return true
  if (complexity.level === 'trivial') return true
  // Under light intensity, a short draft with no build verb has nothing to fix.
  if (intensity === 'light' && complexity.level === 'simple' && text.length <= 12) return true
  return false
}

/**
 * Strip wrappers a model may add despite the output contract.
 *
 * Handles, in order: a leading code fence, a trailing code fence, a leading
 * conversational line, and a leading/trailing blank run. Only *known* wrapper
 * shapes are removed — the function never guesses at content.
 *
 * @param raw - the model's raw text.
 * @returns the cleaned prompt.
 */
export function normalizeModelOutput(raw: string): string {
  let text = raw.trim()

  // A whole answer wrapped in one fence: unwrap it.
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (fenced !== null && fenced[1] !== undefined) text = fenced[1].trim()

  // A leading preamble line followed by a blank line, e.g. "Here is the optimized prompt:".
  const preamble = /^(?:sure|of course|certainly|here(?:'s| is)[^\n]*|好的[^\n]*|当然[^\n]*|以下是[^\n]*|优化后的[^\n]*)[:：]?\s*\n\s*\n/i
  const withoutPreamble = text.replace(preamble, '')
  if (withoutPreamble.trim().length > 0) text = withoutPreamble.trim()

  // A single-line preamble with no blank line after it.
  const inlinePreamble = /^(?:sure|of course|certainly)[,:：]\s+/i
  text = text.replace(inlinePreamble, '')

  return text.trim()
}

/** The outcome of one successful optimization. */
export interface OptimizeOutcome {
  optimized: string
  original: string
  plan: OptimizationPlan
  route: ModelRoute | undefined
  /** True when the model call was skipped entirely. */
  skipped: boolean
}

/**
 * Run one optimization end to end.
 *
 * @param ctx - plugin context exposing `llm`.
 * @param input - the draft, settings, and optional context.
 * @returns the optimized text plus the plan that produced it.
 */
export async function optimize(ctx: LlmContext, input: OptimizeInput): Promise<OptimizeOutcome> {
  const plan = planOptimization(input)

  // The no-op path never touches the network, so it cannot fail or cost tokens.
  if (plan.noop) {
    return { optimized: input.text, original: input.text, plan, route: undefined, skipped: true }
  }

  // Settings win over the session: an explicit `provider/model` is a deliberate
  // user choice, while `current` means "follow the session".
  const route = resolveRoute(ctx, parseModelRoute(input.settings.model), input.sessionRoute)
  const system = buildSystemPrompt({
    domain: plan.domain,
    complexity: plan.complexity,
    intensity: plan.intensity,
    language: plan.language,
    ...(input.projectRules === undefined ? {} : { projectRules: input.projectRules }),
    ...(input.settings.customInstructions.trim().length === 0
      ? {}
      : { userRules: input.settings.customInstructions }),
    ...(input.conversation === undefined ? {} : { conversation: input.conversation }),
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
  })
  const user = buildUserMessage(input.text)

  // Headroom over the budget: the model needs room to think before it writes,
  // and the budget itself is a soft target rather than a hard truncation.
  const maxTokens = Math.min(8000, Math.max(600, Math.ceil(plan.complexity.budget / 2)))

  const result: CompletionResult = await complete(ctx, route, system, user, {
    maxTokens,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })

  const optimized = normalizeModelOutput(result.text)
  return {
    // An empty cleaned result would silently erase the user's text, so fall back
    // to the raw model text, and only then to the original draft.
    optimized: optimized.length > 0 ? optimized : (result.text.trim().length > 0 ? result.text.trim() : input.text),
    original: input.text,
    plan,
    route: result.route,
    skipped: false,
  }
}
