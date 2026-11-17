/**
 * Reads lines around the start of src/tool-contract.ts to extract interfaces, constraints, and validation mechanisms imposed on tools
 * @question What does src/tool-contract.ts define as the contract for tools, including runScript, strict function, and timeout constraints?
 * @returns ReadResult
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const read_tool_contract_around = readAround("src/tool-contract.ts", 1, 5);
