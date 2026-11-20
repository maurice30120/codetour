/**
 * Searches for the term runScript across all files to identify its definition, usage, and constraints
 * @question Find all occurrences of runScript in the workspace to understand the tool contract and its constraints
 * @returns SourceMatch[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const search_runscript = searchText("runScript");
