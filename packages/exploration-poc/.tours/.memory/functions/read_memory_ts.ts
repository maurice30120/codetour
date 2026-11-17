/**
 * Reads src/memory.ts to understand consolidation gates, refusal reasons, and how candidates are accepted or rejected
 * @question How does the memory system handle consolidation refusals and what signals are used?
 * @returns ReadResult
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const read_memory_ts = readLines("src/memory.ts", 1, 100);
