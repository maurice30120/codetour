/**
 * Searches a repository for occurrences of a symbol by exact identifier match and literal text match, deduplicates by file:line, and returns up to limit {file, line, text} candidates. Scope: syntactic search only, no semantic resolution. Limits: capped by limit (default 3); text may be empty.
 * @question How does loadConfig load configuration in config.ts?
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
