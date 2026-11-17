import { createHash } from 'node:crypto';

/** Guidance for exploring one question after the initial planning call. */
export const DECOMPOSITION_PROMPT = 'Investigate the supplied technical question. Treat the initial research plan as a flexible guide: follow new evidence freely without revising or tracking the plan. When memory is enabled, consult memory_list for useful capabilities and run matching procedures with memory_run, verify their evidence, and investigate only what is missing. In Code Mode with memory, use function_try to explore via the provided primitives and propose useful parameterized procedures. Do not recreate equivalent procedures or nest memorized procedures. Do not write a Tour. Return sourced findings and explicit uncertainties.';
export const PROMPT_VERSION = '5';
export const PROMPT_SHA256 = createHash('sha256').update(DECOMPOSITION_PROMPT, 'utf8').digest('hex');
