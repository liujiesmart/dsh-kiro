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
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
/**
 * One rung of the narrowing ladder.
 *
 * The two halves a client can drop without inventing anything are the system
 * text and the conversation. They are not equally expensive to lose: dropping
 * history ends the conversation the user is having — the model answers the last
 * message with no idea what it is about — while dropping system text only ends
 * the operator's standing instructions. So every rung sheds the system prompt
 * first and the conversation last, and the last rung still keeps recent turns.
 *
 * Tool definitions are never dropped: a turn that cannot call tools is not the
 * turn the harness asked for.
 */
export interface NarrowingStep {
    /**
     * Messages kept from the tail of the conversation, the current turn included.
     * Absent keeps the whole conversation, which is what the first rungs want.
     */
    keepHistory?: number;
    /**
     * Head budget in characters for the system prompt. `undefined` keeps it
     * whole; `0` drops it entirely.
     */
    systemBudget?: number;
    /** How this rung is described in the terminal failure message. */
    label: string;
}
/**
 * The ladder, cheapest to lose first.
 *
 * A refusal is almost always the instruction text, so the first rung keeps the
 * conversation intact and only clips the system prompt — if it answers, the
 * user's thread is untouched. History is reduced only after both system-prompt
 * rungs have failed, and never below the last six messages, because a reply
 * that has forgotten the conversation is not a recovery from the user's point
 * of view.
 */
export declare const NARROWING_LADDER: readonly NarrowingStep[];
/** Default number of narrowing retries, one per ladder rung. */
export declare const DEFAULT_REFUSAL_RECOVERY_ATTEMPTS: number;
/** Upper bound on narrowing retries, so a refusal cannot multiply spend without a limit. */
export declare const MAX_REFUSAL_RECOVERY_ATTEMPTS: number;
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
export declare function clipSystem(text: string | undefined, budget: number): string;
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
export declare function narrowRequest(options: GenerateOptions, step: NarrowingStep): GenerateOptions;
/**
 * The rungs a run will actually use, capped by the configured attempt bound.
 * @param recovery - whether narrowing is enabled at all.
 * @param attempts - the configured retry bound.
 * @returns the rungs in order; empty when narrowing is off.
 */
export declare function narrowLadder(recovery: 'off' | 'narrow', attempts: number): readonly NarrowingStep[];
