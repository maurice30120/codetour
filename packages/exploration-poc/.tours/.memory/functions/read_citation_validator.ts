/**
 * Reads the source of src/citation-validator.ts to extract exported functions, validation rules, refusal reasons, and how it interacts with tool history
 * @question What does src/citation-validator.ts do regarding validation rules, refusal reasons, and interaction with tool history?
 * @returns ReadResult
 * @remarks Bounded by the workspace sandbox and output limits.
 */
export const read_citation_validator = readLines("src/citation-validator.ts", 1, 100);
