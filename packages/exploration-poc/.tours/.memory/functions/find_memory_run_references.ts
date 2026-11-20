/**
 * Searches the entire codebase for any occurrence of 'memory_run' to identify how it is called and what parameters it expects
 * @question Find all references to memory_run in the codebase to understand its usage and parameters
 * @returns { file: string; line: number; context: string; }[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const find_memory_run_references = function findMemoryRunReferences(): { file: string; line: number; context: string }[] {
  // Search for memory_run function calls or definitions
  const matches = searchText('memory_run');
  return matches.map(m => ({ file: m.file, line: m.line, context: m.text.trim() }));
};
