/**
 * Reads the TypeScript declaration file for sandbox to extract the runScript signature and sandbox constraints
 * @question What does src/sandbox.d.ts define about runScript and sandboxing constraints?
 * @returns ReadResult
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const read_sandbox_types_short = readLines("src/sandbox.d.ts", 1, 3);
