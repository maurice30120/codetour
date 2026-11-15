import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Import error classes only (interfaces are type-only and not available at runtime)
import {
  InvalidPathError,
  PathOutsideWorkspaceError,
  FileTooLargeError,
  InvalidRangeError,
  InvalidQueryError
} from './primitives.ts';

const run = promisify(execFile);

// Configuration constants
const MAX_FILES = 500;
const MAX_BYTES = 1024 * 1024; // 1MB
const MAX_OUTPUT = 12000;
const MAX_SEARCH_RESULTS = 50;
const MAX_SYMBOLS = 100;
const MAX_DEFINITIONS = 20;
const MAX_REFERENCES = 50;
const MAX_CONTEXT_LINES = 20;
const MAX_READ_LINES = 100;

/**
 * Read-only workspace interface. Symlinks escaping the workspace are rejected.
 * All operations are safe, bounded, and sourced.
 */
export async function workspace(root: string) {
  const base = await realpath(root);
  const cache = new Map<string, string[]>();

  // ==========================================================================
  // Validation Helpers
  // ==========================================================================

  /** Validate and resolve a path within the workspace */
  async function checked(path: string): Promise<string> {
    if (!path || typeof path !== 'string' || path.length > 1000) {
      throw new InvalidPathError(path);
    }
    const target = await realpath(resolve(base, path));
    const rel = relative(base, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(base, rel) !== target) {
      throw new PathOutsideWorkspaceError(path);
    }
    return target;
  }

  /** Validate file size */
  async function validateFileSize(filePath: string): Promise<void> {
    const path = await checked(filePath);
    const info = await stat(path);
    if (!info.isFile()) {
      throw new InvalidPathError(filePath);
    }
    if (info.size > MAX_BYTES) {
      throw new FileTooLargeError(filePath, info.size, MAX_BYTES);
    }
  }

  /** Validate line range */
  function validateLineRange(startLine: number, endLine: number): void {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) ||
        startLine < 1 || endLine < startLine || endLine - startLine >= MAX_READ_LINES) {
      throw new InvalidRangeError(`Invalid line range: ${startLine}-${endLine}`);
    }
  }

  /** Validate query */
  function validateQuery(query: string): void {
    if (!query || typeof query !== 'string' || query.length > 200) {
      throw new InvalidQueryError(query);
    }
  }

  // ==========================================================================
  // listFiles - List files in the workspace
  // ==========================================================================

  async function listFiles(options = {}) {
    const { maxFiles = MAX_FILES, prefix = '', includeDirectories = false, internal = false } = options;
    
    const maxLimit = internal ? 50000 : 10000;
    if (maxFiles < 1 || maxFiles > maxLimit) {
      throw new InvalidRangeError('maxFiles must be between 1 and 10000');
    }

    const files: string[] = [];
    let truncated = false;

    async function visit(dir: string, currentPrefix: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) {
          continue;
        }
        const name = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name;
        if (!name.startsWith(prefix)) {
          if (entry.isDirectory()) {
            await visit(resolve(dir, entry.name), name);
          }
          continue;
        }
        if (entry.isDirectory()) {
          if (includeDirectories) {
            files.push(name + '/');
          }
          await visit(resolve(dir, entry.name), name);
        } else if (entry.isFile()) {
          files.push(name);
        }
      }
    }

    await visit(base, '');
    return { files: files.sort(), truncated };
  }

  // ==========================================================================
  // readLines - Read specific lines from a file
  // ==========================================================================

  async function readLines(file: string, options = {}) {
    const { startLine = 1, endLine = startLine + MAX_READ_LINES - 1, fresh = false } = options;
    
    validateLineRange(startLine, endLine);
    await validateFileSize(file);
    
    const path = await checked(file);
    let lines = fresh ? undefined : cache.get(path);
    
    if (!lines) {
      const text = await readFile(path, 'utf8');
      lines = text === '' ? [] : text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      cache.set(path, lines);
    }

    const resultLines = lines.slice(startLine - 1, endLine).map((text, i) => ({
      line: startLine + i,
      text
    })).slice(0, MAX_READ_LINES);

    return {
      file,
      startLine,
      endLine: startLine + resultLines.length - 1,
      lines: resultLines,
      totalLines: lines.length
    };
  }

  // ==========================================================================
  // searchText - Search for text in files
  // ==========================================================================

  async function searchText(query: string, options = {}) {
    validateQuery(query);
    
    const { limit = MAX_SEARCH_RESULTS, offset = 0, pathPrefix = '', caseSensitive = true } = options;
    
    if (limit < 1 || limit > MAX_SEARCH_RESULTS * 2) {
      throw new InvalidRangeError(`limit must be between 1 and ${MAX_SEARCH_RESULTS * 2}`);
    }
    if (offset < 0 || offset > 1000) {
      throw new InvalidRangeError('offset must be between 0 and 1000');
    }

    const matches: { file: string; line: number; text: string }[] = [];
    let hasMore = false;
    let fileScanLimitReached = false;
    let seen = 0;

    const files = await listFiles({ maxFiles: 30000, prefix: pathPrefix, internal: true });
    fileScanLimitReached = files.truncated;

    for (const file of files.files) {
      if (seen >= offset + limit) {
        hasMore = true;
        break;
      }

      try {
        await validateFileSize(file);
        const path = await checked(file);
        const text = await readFile(path, 'utf8');
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          const searchText = caseSensitive ? lineText : lineText.toLowerCase();
          const searchQuery = caseSensitive ? query : query.toLowerCase();
          
          if (searchText.includes(searchQuery)) {
            if (seen++ < offset) continue;
            if (matches.length < limit) {
              matches.push({
                file,
                line: i + 1,
                text: lineText.slice(0, 500)
              });
            } else {
              hasMore = true;
              break;
            }
          }
        }
      } catch {
        // unreadable files are not evidence
      }

      if (hasMore) break;
    }

    return {
      items: matches,
      offset,
      limit,
      hasMore,
      query,
      fileScanLimitReached
    };
  }

  // ==========================================================================
  // searchIdentifiers - Search for exact identifier matches
  // ==========================================================================

  async function searchIdentifiers(identifier: string, options = {}) {
    validateQuery(identifier);
    
    const { limit = MAX_SEARCH_RESULTS, offset = 0, pathPrefix = '' } = options;
    
    if (limit < 1 || limit > MAX_SEARCH_RESULTS * 2) {
      throw new InvalidRangeError(`limit must be between 1 and ${MAX_SEARCH_RESULTS * 2}`);
    }
    if (offset < 0 || offset > 1000) {
      throw new InvalidRangeError('offset must be between 0 and 1000');
    }

    // Escape special regex characters in identifier
    const pattern = new RegExp(
      `\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'g'
    );

    const matches: { file: string; line: number; text: string }[] = [];
    let hasMore = false;
    let fileScanLimitReached = false;
    let seen = 0;

    const files = await listFiles({ maxFiles: 30000, prefix: pathPrefix, internal: true });
    fileScanLimitReached = files.truncated;

    for (const file of files.files) {
      if (seen >= offset + limit) {
        hasMore = true;
        break;
      }

      try {
        await validateFileSize(file);
        const path = await checked(file);
        const text = await readFile(path, 'utf8');
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          let match;
          while ((match = pattern.exec(lineText)) !== null) {
            if (seen++ < offset) continue;
            if (matches.length < limit) {
              matches.push({
                file,
                line: i + 1,
                text: lineText.slice(0, 500)
              });
            } else {
              hasMore = true;
              break;
            }
          }
          pattern.lastIndex = 0; // Reset regex state for next line
          if (hasMore) break;
        }
      } catch {
        // unreadable files are not evidence
      }

      if (hasMore) break;
    }

    return {
      items: matches,
      offset,
      limit,
      hasMore,
      identifier,
      fileScanLimitReached
    };
  }

  // ==========================================================================
  // readAround - Read context around a specific line
  // ==========================================================================

  async function readAround(file: string, options: any) {
    const { line, contextLines = 5 } = options;
    
    if (!Number.isInteger(line) || line < 1) {
      throw new InvalidRangeError(`Invalid line number: ${line}`);
    }
    if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > MAX_CONTEXT_LINES) {
      throw new InvalidRangeError(`contextLines must be between 0 and ${MAX_CONTEXT_LINES}`);
    }

    await validateFileSize(file);
    
    const startLine = Math.max(1, line - contextLines);
    const endLine = line + contextLines;
    
    const result = await readLines(file, { startLine, endLine, fresh: false });

    return {
      file,
      centerLine: line,
      startLine: result.startLine,
      endLine: result.endLine,
      lines: result.lines
    };
  }

  // ==========================================================================
  // listSymbols - List symbols in the workspace
  // ==========================================================================

  async function listSymbols(options = {}) {
    const { limit = MAX_SYMBOLS, offset = 0, pathPrefix = '', kind: filterKind } = options;
    
    if (limit < 1 || limit > MAX_SYMBOLS * 2) {
      throw new InvalidRangeError(`limit must be between 1 and ${MAX_SYMBOLS * 2}`);
    }
    if (offset < 0 || offset > 1000) {
      throw new InvalidRangeError('offset must be between 0 and 1000');
    }

    const symbols: { file: string; line: number; name: string; kind: string }[] = [];
    let hasMore = false;
    let fileScanLimitReached = false;
    let seen = 0;

    const patterns = [
      { regex: /function\s+(\w+)/g, kind: 'function' },
      { regex: /class\s+(\w+)/g, kind: 'class' },
      { regex: /interface\s+(\w+)/g, kind: 'interface' },
      { regex: /type\s+(\w+)\s*=/g, kind: 'type' },
      { regex: /enum\s+(\w+)/g, kind: 'enum' },
      { regex: /const\s+(\w+)/g, kind: 'constant' },
      { regex: /let\s+(\w+)/g, kind: 'variable' },
      { regex: /var\s+(\w+)/g, kind: 'variable' },
      { regex: /export\s+(?:function|class|const|let|var|interface|type)\s+(\w+)/g, kind: 'export' },
      { regex: /import\s+(\w+)/g, kind: 'import' }
    ];

    const files = await listFiles({ maxFiles: 30000, prefix: pathPrefix, internal: true });
    fileScanLimitReached = files.truncated;

    for (const file of files.files) {
      if (seen >= offset + limit) {
        hasMore = true;
        break;
      }

      try {
        await validateFileSize(file);
        const path = await checked(file);
        const text = await readFile(path, 'utf8');
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          for (const { regex, kind } of patterns) {
            if (filterKind && kind !== filterKind) continue;
            let match;
            while ((match = regex.exec(lineText)) !== null) {
              if (seen++ < offset) continue;
              if (symbols.length < limit) {
                symbols.push({
                  file,
                  line: i + 1,
                  name: match[1],
                  kind
                });
              } else {
                hasMore = true;
                break;
              }
            }
          }
          if (hasMore) break;
        }
      } catch {
        // unreadable files are not evidence
      }

      if (hasMore) break;
    }

    return {
      items: symbols,
      offset,
      limit,
      hasMore,
      fileScanLimitReached
    };
  }

  // ==========================================================================
  // findDefinitions - Find definitions of a symbol
  // ==========================================================================

  async function findDefinitions(symbol: string, options = {}) {
    validateQuery(symbol);
    
    const { limit = MAX_DEFINITIONS, offset = 0, pathPrefix = '' } = options;
    
    if (limit < 1 || limit > MAX_DEFINITIONS * 2) {
      throw new InvalidRangeError(`limit must be between 1 and ${MAX_DEFINITIONS * 2}`);
    }
    if (offset < 0 || offset > 100) {
      throw new InvalidRangeError('offset must be between 0 and 100');
    }

    const definitions: { file: string; line: number; text: string; kind: string }[] = [];
    let hasMore = false;
    let fileScanLimitReached = false;
    let seen = 0;

    const patterns = [
      { regex: new RegExp(`\\bfunction\\s+${symbol}\\s*\\(`), kind: 'function' },
      { regex: new RegExp(`\\bclass\\s+${symbol}\\s*\\{`), kind: 'class' },
      { regex: new RegExp(`\\binterface\\s+${symbol}\\s*\\{`), kind: 'interface' },
      { regex: new RegExp(`\\btype\\s+${symbol}\\s*=`), kind: 'type' },
      { regex: new RegExp(`\\benum\\s+${symbol}\\s*\\{`), kind: 'enum' },
      { regex: new RegExp(`\\bconst\\s+${symbol}\\s*=`), kind: 'constant' },
      { regex: new RegExp(`\\blet\\s+${symbol}\\s*=`), kind: 'variable' },
      { regex: new RegExp(`\\bvar\\s+${symbol}\\s*=`), kind: 'variable' },
      { regex: new RegExp(`\\bexport\\s+(?:function|class|const|let|var|interface|type)\\s+${symbol}`), kind: 'export' }
    ];

    const files = await listFiles({ maxFiles: 30000, prefix: pathPrefix, internal: true });
    fileScanLimitReached = files.truncated;

    for (const file of files.files) {
      if (seen >= offset + limit) {
        hasMore = true;
        break;
      }

      try {
        await validateFileSize(file);
        const path = await checked(file);
        const text = await readFile(path, 'utf8');
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          for (const { regex, kind } of patterns) {
            if (regex.test(lineText)) {
              if (seen++ < offset) continue;
              if (definitions.length < limit) {
                definitions.push({
                  file,
                  line: i + 1,
                  text: lineText.slice(0, 500),
                  kind
                });
              } else {
                hasMore = true;
                break;
              }
            }
            regex.lastIndex = 0; // Reset regex state
          }
          if (hasMore) break;
        }
      } catch {
        // unreadable files are not evidence
      }

      if (hasMore) break;
    }

    return {
      items: definitions,
      offset,
      limit,
      hasMore,
      symbol,
      fileScanLimitReached
    };
  }

  // ==========================================================================
  // findReferences - Find references to a symbol
  // ==========================================================================

  async function findReferences(symbol: string, options = {}) {
    validateQuery(symbol);
    
    const { limit = MAX_REFERENCES, offset = 0, pathPrefix = '', includeDeclaration = false } = options;
    
    if (limit < 1 || limit > MAX_REFERENCES * 2) {
      throw new InvalidRangeError(`limit must be between 1 and ${MAX_REFERENCES * 2}`);
    }
    if (offset < 0 || offset > 1000) {
      throw new InvalidRangeError('offset must be between 0 and 1000');
    }

    // For references, we use searchIdentifiers
    const result = await searchIdentifiers(symbol, { 
      limit: limit + (includeDeclaration ? 0 : 10),
      offset,
      pathPrefix
    });

    // If we don't want to include declarations, we'd need to filter them out
    // For now, just return the search results as references
    return {
      items: result.items,
      offset: result.offset,
      limit: result.limit,
      hasMore: result.hasMore,
      symbol,
      fileScanLimitReached: result.fileScanLimitReached
    };
  }

  // ==========================================================================
  // getImports - Get imports from a file
  // ==========================================================================

  async function getImports(options: any) {
    const { filePath } = options;
    
    if (!filePath || typeof filePath !== 'string') {
      throw new InvalidPathError(filePath);
    }

    await validateFileSize(filePath);
    
    const path = await checked(filePath);
    const text = await readFile(path, 'utf8');
    const imports: { file: string; line: number; text: string; path?: string }[] = [];
    const lines = text.split('\n');
    
    // Match various import patterns
    const patterns = [
      /\bimport\s+(?:{[^}]*}|[^'"`;]+)\s+from\s+['"`]([^'"`;]+)['"`]/g,
      /\bimport\s+['"`]([^'"`;]+)['"`]/g,
      /\brequire\s*\(\s*['"`]([^'"`;]+)['"`]\s*\)/g,
      /\bfrom\s+['"`]([^'"`;]+)['"`]/g,
      /import\s*\(\s*['"`]([^'"`;]+)['"`]\s*\)/g
    ];

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(lineText)) !== null) {
          imports.push({
            file: filePath,
            line: i + 1,
            text: lineText.slice(0, 500),
            path: match[1]
          });
        }
        pattern.lastIndex = 0;
      }
    }

    return {
      file: filePath,
      imports,
      revision: undefined
    };
  }

  // ==========================================================================
  // getGitDiff - Get git diff between revisions
  // ==========================================================================

  async function getGitDiff(options: any) {
    const { revision1, revision2 = 'HEAD', filePath } = options;
    
    if (!revision1 || typeof revision1 !== 'string' || revision1.length > 100) {
      throw new InvalidQueryError(revision1);
    }
    if (!revision2 || typeof revision2 !== 'string' || revision2.length > 100) {
      throw new InvalidQueryError(revision2);
    }

    const args = ['-C', base, 'diff', '--no-color', revision1, revision2];
    if (filePath) {
      args.push('--', filePath);
    }

    const { stdout } = await run('git', args, {
      timeout: Math.max(1, Math.min(3000, 3000)),
      maxBuffer: MAX_OUTPUT,
      env: {
        PATH: process.env.PATH,
        HOME: base,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0'
      }
    });

    // Parse the raw diff into structured format
    // For now, return raw diff - parsing can be enhanced later
    return {
      oldRevision: revision1,
      newRevision: revision2,
      files: [],
      rawDiff: stdout.slice(0, MAX_OUTPUT)
    };
  }

  // ==========================================================================
  // Git helper (for backward compatibility)
  // ==========================================================================

  async function git(timeout = 3000) {
    const { stdout } = await run('git', ['-C', base, 'log', '-1', '--format=%H%n%s'], {
      timeout: Math.max(1, Math.min(3000, timeout)),
      maxBuffer: MAX_OUTPUT,
      env: {
        PATH: process.env.PATH,
        HOME: base,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0'
      }
    });
    return stdout.slice(0, MAX_OUTPUT);
  }

  // ==========================================================================
  // Backward compatibility aliases
  // ==========================================================================

  /** @deprecated Use listFiles instead */
  async function list(maxFiles = MAX_FILES) {
    const result = await listFiles({ maxFiles });
    return result.files;
  }

  /** @deprecated Use readLines instead */
  async function read(file: string, startLine = 1, endLine = startLine + 99, fresh = false) {
    const result = await readLines(file, { startLine, endLine, fresh });
    return result.lines.map(l => ({ line: l.line, text: l.text }));
  }

  /** @deprecated Use searchText instead */
  async function search(query: string) {
    const result = await searchText(query);
    return result.items;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  return {
    // New typed API
    listFiles,
    searchText,
    searchIdentifiers,
    readLines,
    readAround,
    listSymbols,
    findDefinitions,
    findReferences,
    getImports,
    getGitDiff,
    
    // Backward compatibility
    list,
    read,
    search,
    git
  };
}
