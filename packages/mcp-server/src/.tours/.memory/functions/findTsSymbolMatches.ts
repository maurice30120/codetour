/**
 * Searches TypeScript files for a symbol and returns deduplicated file, line and text matches. Results are bounded and syntactic only.
 * @question Where is the symbol writeTourAtomic declared in the repository?
 * @param symbol string
 * @param limit number | undefined
 * @returns { file: string; line: number; text: string; }[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const findTsSymbolMatches = (params: {symbol: string, limit?: number}) => { const limit = params.limit ?? 5; const hits = [...searchIdentifiers(params.symbol), ...searchText(params.symbol)]; const seen = new Set<string>(); return hits.filter(r => r.file.endsWith(".ts") && !r.file.startsWith(".tours/")).filter(r => { const key = r.file + ":" + r.line; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit).map(r => ({file:r.file,line:r.line,text:r.text || ""})); };
