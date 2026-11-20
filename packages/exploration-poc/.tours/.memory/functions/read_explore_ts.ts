/**
 * Reads src/explore.ts to understand how runScript is called, how strict mode and timeouts are enforced, and how outputs are validated
 * @question How does the harness execute tools and control their execution via sandboxing and strict mode?
 * @returns ReadResult
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const read_explore_ts = readLines("src/explore.ts", 1, 100);
