/**
 * Combines searchIdentifiers and searchText for a symbol, deduplicates by file:line, and returns up to limit matches as {file, line, text}. Scope: whole repository, syntactic candidates only. Limits: capped at limit results, so a declaration may be missed for frequent symbols.
 * @question Where is the function activate declared in extension.ts?
 * @param symbol string
 * @param limit number | undefined
 * @returns { file: string; line: number; text: string; }[]
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const findSymbolOccurrences = (params: {symbol: string, limit?: number}) => {
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
