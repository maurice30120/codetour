const string = { type: 'string' };
const integer = { type: 'integer' };

export const primitiveTools = [
  { name: 'listFiles', description: 'List repository paths', properties: { maxFiles: integer } },
  { name: 'searchText', description: 'Find literal text; syntax does not prove a semantic relationship', properties: { query: string }, required: ['query'] },
  { name: 'searchIdentifiers', description: 'Find exact identifier occurrences', properties: { identifier: string }, required: ['identifier'] },
  { name: 'readLines', description: 'Read a page of up to 100 source lines; repeat with nextLine and the same endLine. truncatedLines identifies lines needing readLineFragment.', properties: { file: string, startLine: integer, endLine: integer }, required: ['file', 'startLine', 'endLine'] },
  { name: 'readLineFragment', description: 'Read a fragment of a long source line; continue with nextOffset until null.', properties: { file: string, line: integer, offset: integer }, required: ['file', 'line', 'offset'] },
  { name: 'readAround', description: 'Read context around a source line', properties: { file: string, line: integer, contextLines: integer }, required: ['file', 'line'] },
  { name: 'listSymbols', description: 'List syntactic symbol candidates', properties: {} },
  { name: 'findDefinitions', description: 'Find candidate definitions; no semantic resolution guarantee', properties: { symbol: string }, required: ['symbol'] },
  { name: 'findReferences', description: 'Find candidate references; no semantic resolution guarantee', properties: { symbol: string }, required: ['symbol'] },
  { name: 'getImports', description: 'Find declared import candidates', properties: { file: string }, required: ['file'] },
  { name: 'getGitDiff', description: 'Read a bounded diff between validated revisions', properties: { revision1: string, revision2: string }, required: ['revision1'] }
].map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: { type: 'object', properties: tool.properties, required: tool.required ?? [] } } }));

export const primitiveNames = new Set(primitiveTools.map(tool => tool.function.name));
