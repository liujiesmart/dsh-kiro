/**
 * Request narrowing for Kiro's silent refusal.
 *
 * The service answers a refused request with HTTP 200, bills it, streams usage
 * and metering frames, and returns no assistant event and no `stopReason` at
 * all. Nothing in that shape names the offending content, so the only lever a
 * client has is to make the request smaller and ask again: the refusal is
 * deterministic for the exact bytes sent, and a strictly smaller request is a
 * different question.
 *
 * @module dsh-kiro/refusal
 */

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

/**
 * One rung of the narrowing ladder.
 *
 * History and system text are the two halves a client can drop without lying
 * about the conversation: the messages are real turns the model has already
 * seen, and the system prompt is the caller's own instruction text. Tool
 * definitions are never dropped — a turn that cannot call tools is not the
 * turn the harness asked for.
 */
export interface NarrowingStep {
  /** Messages kept from the tail of the conversation, the current turn included. */
  keepHistory: number
  /**
   * Head budget in characters for the system prompt. `undefined` keeps it
   * whole; `0` drops it entirely.
   */
  systemBudget?: number
  /** How this rung is described in the terminal failure message. */
  label: string
}

/**
 * The ladder, cheapest first.
 *
 * Each rung is a strictly smaller request than the one before, so a rung can
 * only ever succeed where its predecessor was refused. The first rung leaves
 * the system prompt alone because a long conversation is the more common
 * trigger; the last one drops it because a refusal that survives every history
 * trim is a refusal of the instruction text itself.
 */
export const NARROWING_LADDER: readonly NarrowingStep[] = [
  { keepHistory: 6, label: 'retried with the last 6 messages' },
  {
    keepHistory: 2,
    systemBudget: 8_000,
    label: 'retried with the last 2 messages and the system prompt trimmed to 8000 characters',
  },
  {
    keepHistory: 1,
    systemBudget: 0,
    label: 'retried with the current turn only and no system prompt',
  },
]

/** Default number of narrowing retries, one per ladder rung. */
export const DEFAULT_REFUSAL_RECOVERY_ATTEMPTS = NARROWING_LADDER.length
/** Upper bound on narrowing retries, so a refusal cannot multiply spend without a limit. */
export const MAX_REFUSAL_RECOVERY_ATTEMPTS = NARROWING_LADDER.length

/**
 * Clip a system prompt to a character budget at a paragraph boundary.
 *
 * The cut backs off to the last newline when one sits in the final fifth of the
 * budget, so the surviving prompt does not end mid-sentence, which models read
 * as an instruction that stopped for a reason.
 * @param text - the system prompt, possibly absent or empty.
 * @param budget - maximum characters to keep; `0` keeps nothing.
 * @returns the surviving system text, never longer than the budget.
 */
export function clipSystem(text: string | undefined, budget: number): string {
  const source = text ?? ''
  if (budget <= 0) return ''
  if (source.length <= budget) return source
  const head = source.slice(0, budget)
  const boundary = head.lastIndexOf('\n')
  return boundary > budget * 0.8 ? head.slice(0, boundary) : head
}

/**
 * Build the request one ladder rung asks for.
 *
 * The result is a new `GenerateOptions`; the caller's value is never mutated,
 * because the next rung is computed from the original rather than the previous
 * attempt.
 * @param options - the request the harness asked for.
 * @param step - the rung to apply.
 * @returns the narrowed request.
 */
export function narrowRequest(options: GenerateOptions, step: NarrowingStep): GenerateOptions {
  const keep = Math.max(1, Math.trunc(step.keepHistory))
  const messages = options.messages.slice(-keep)
  const system = step.systemBudget === undefined
    ? options.system
    : clipSystem(options.system, step.systemBudget)
  return {
    ...options,
    messages,
    ...system === undefined ? {} : { system },
  }
}

/**
 * The rungs a run will actually use, capped by the configured attempt bound.
 * @param recovery - whether narrowing is enabled at all.
 * @param attempts - the configured retry bound.
 * @returns the rungs in order; empty when narrowing is off.
 */
export function narrowLadder(
  recovery: 'off' | 'narrow',
  attempts: number,
): readonly NarrowingStep[] {
  if (recovery === 'off') return []
  const bound = Math.max(0, Math.min(Math.trunc(attempts), MAX_REFUSAL_RECOVERY_ATTEMPTS))
  return NARROWING_LADDER.slice(0, bound)
}