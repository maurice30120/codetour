/**
 * Token estimate shared by the context extractors and the benchmark.
 *
 * This is an approximation, not a tokenizer: roughly four characters per
 * token. Any figure derived from it must be labelled as an estimate.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
