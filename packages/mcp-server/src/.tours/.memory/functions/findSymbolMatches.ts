/**
 * Searches for a symbol by identifier and literal text, deduplicates matches by file:line, and returns up to limit matches with file, line and text. Scope: whole repository, syntactic matches only (no semantic resolution). Limits: capped at limit results, text may be empty for identifier-only matches.
 * @question Where is the symbol handleCreateProjectTour declared in server.ts?
 * @param symbol string
 * @param limit number | undefined
 * @returns { file: string; line: number; text: string; }[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const findSymbolMatches = (params: {symbol: string, limit?: number}) => {
  const limit = params.limit ?? 3;
  const byId = searchIdentifiers(params.symbol).map(r => ({file: r.file, line: r.line, text: r.text || ''}));
  const byText = searchText(params.symbol).map(r => ({file: r.file, line: r.line, text: r.text || ''}));
  const seen = new Set<string>();
  const out: {file: string, line: number, text: string}[] = [];
  for (const r of [...byId, ...byText]) {
    const key = r.file + ':' + r.line;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
};
