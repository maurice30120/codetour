/**
 * Searches for the export of runScript to extract its signature and constraints
 * @question Find the definition of runScript to understand the tool contract and sandboxing constraints
 * @returns SourceMatch[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const search_runscript_export = searchText("export function runScript");
