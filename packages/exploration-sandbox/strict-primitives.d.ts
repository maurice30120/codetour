interface SourceMatch { file: string; line: number; text: string; revision?: string }
interface SearchPage { pathPrefix?: string; offset?: number; limit?: number }
interface ReadResult { file: string; start: number; lines: string[] }
interface ReadPage extends ReadResult { nextLine: number | null; truncatedLines: number[] }
declare function listFiles(maxFiles?: number): string[];
declare function searchText(query: string): SourceMatch[];
declare function searchText(query: string, options: SearchPage): { matches: SourceMatch[]; offset: number; limit: number; hasMore: boolean; fileScanLimitReached: boolean };
declare function searchIdentifiers(identifier: string): SourceMatch[];
declare function readLines(file: string, startLine: number, endLine: number): ReadPage;
declare function readLineFragment(file: string, line: number, offset: number): { file: string; line: number; offset: number; content: string; nextOffset: number | null };
declare function readAround(file: string, line: number, contextLines?: number): ReadResult;
declare function listSymbols(): Array<{ file: string; line: number; name: string; kind: string }>;
declare function findDefinitions(symbol: string): Array<SourceMatch & { kind: string }>;
declare function findReferences(symbol: string): SourceMatch[];
declare function getImports(file: string): SourceMatch[];
declare function getGitDiff(revision1: string, revision2?: string): string;
