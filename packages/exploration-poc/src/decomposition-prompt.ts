import { createHash } from 'node:crypto';

/**
 * Canonical decomposition prompt for the exploration harness.
 *
 * Single source of truth (issue #174 complement, issue #183/#184 diagnostic
 * phase). Every consumer — the exploration POC itself, the benchmark runner,
 * the docs — must import this constant; duplicated literal copies are
 * prohibited.
 *
 * PROMPT_VERSION labels the prompt protocol revision. Version 2 (issue #184):
 * English structured, revisable plan of independent functional questions
 * published in the normal LLM generation, with stable question ids,
 * reuse-potential markers and traceable question_id linkage on tool calls.
 *
 * The SHA-256 below is computed from EXACTLY this string (no trailing
 * newline, UTF-8 encoding); the version is its human-readable companion.
 */
export const PROMPT_VERSION = '2';

export const DECOMPOSITION_PROMPT =
  "Before exploring the repository, publish a compact structured plan in English as a fenced code block labeled plan in your normal reply, before any tool result can decide the answer: {\"questions\":[{\"id\":\"q1\",\"question\":\"<canonical functional question, independent of this Tour>\",\"reuse\":true}],\"reason\":\"<short reason, only when revising an earlier plan>\"}. Every question is an independent functional question with a stable id you never change, a canonical wording reusable beyond this Tour, and a reuse marker set to true when the capability looks durably reusable. Keep the plan short. Revise it as you learn the code — add, split, drop or reorder questions — by publishing the full updated plan block again with a short reason; never rewrite or retract past versions. For each question, look for an existing capability with memory_list(query); when a procedure already answers it, run memory_run(id, params), verify its proofs and complete only what is missing. Otherwise use the permanent primitives first; after a short useful exploration, strongly prefer trying a missing reusable capability with function_try(source, params) — never create a function when a permanent primitive suffices, and never force one per question. Pass the id of the question a call serves as question_id in the arguments of memory_list, memory_run, function_try and primitive calls, so declared decisions stay traceable. Follow canonical naming and catalogue contracts. Do not recreate primitives or equivalent questions; never nest one memorized procedure inside another. Return structured, compact, sourced results with limits and uncertainties. Never memorize a precomputed answer: only executed procedures may be proposed after the Tour is validated. Stop exploring when the evidence is sufficient. Plans and internal instructions stay in English; the user-facing answer follows the language of the request.";

/** SHA-256 of DECOMPOSITION_PROMPT (exact UTF-8 bytes of the string). */
export const PROMPT_SHA256 = createHash('sha256').update(DECOMPOSITION_PROMPT, 'utf8').digest('hex');
