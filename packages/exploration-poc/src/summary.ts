// Compact digest of a research result so a calling agent need not parse the full JSON.
const countReferences = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + countReferences(item), 0);
  if (!value || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const own = typeof record.file === 'string' && (typeof record.line === 'number' || typeof record.startLine === 'number') ? 1 : 0;
  return own + Object.values(record).reduce((total: number, item) => total + countReferences(item), 0);
};

export function summarize(result: any, outputFile?: string) {
  const report = result?.consolidationReport;
  const metrics = result?.metrics ?? {};
  return {
    status: result?.status,
    stopReason: result?.stopReason ?? null,
    runId: result?.runId,
    error: result?.error,
    tokens: { input: metrics.inputTokens, output: metrics.outputTokens, usageAvailable: metrics.usageAvailable },
    durationMs: metrics.durationMs,
    modelCalls: metrics.modelCalls,
    toolCalls: metrics.toolCalls,
    memoryReuses: metrics.memoryReuses,
    functionTries: metrics.functionTries,
    citations: countReferences(result?.entryPoints) + countReferences(result?.components) + countReferences(result?.relations),
    uncertainties: Array.isArray(result?.uncertainties) ? result.uncertainties.length : undefined,
    memory: report ? { accepted: report.accepted ?? [], rejected: report.rejected ?? [] } : undefined,
    outputFile
  };
}
