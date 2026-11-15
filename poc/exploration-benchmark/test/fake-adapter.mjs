// Deterministic test double; it is not a model and produces no benchmark result.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (request.mode !== process.argv[2] || process.env.EXPLORATION_MODE !== request.mode || 'expected' in request) process.exit(2);
if (request.mode === 'baseline' && request.objective.includes('Catalog')) process.exit(3);
process.stdout.write(JSON.stringify({ status: 'partial', stopReason: 'iterations', entryPoints: [{ name: 'totalPrice', evidence: [{ file: 'src/math.js', startLine: 1, endLine: 2 }] }], components: [], relations: [], metrics: { inputTokens: 7, outputTokens: 3, usageAvailable: request.mode !== 'code-mode', modelCalls: 2, toolCalls: 3, outputBytes: 40 } }));
