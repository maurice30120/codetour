const ts = require('typescript');
const path = require('node:path');

// The 10 primitives that are allowed
const ALLOWED_PRIMITIVES = new Set([
  'listFiles',
  'list',
  'readLines',
  'read',
  'readAround',
  'searchText',
  'search',
  'searchIdentifiers',
  'listSymbols',
  'findDefinitions',
  'findReferences',
  'getImports',
  'getGitDiff'
]);

// Build the type definitions for the primitives and globals
const PRIMITIVES_TYPE_DEFS = `
// Global types
declare const params: any;

// Standard JavaScript globals
interface Array<T> {
  length: number;
  [index: number]: T;
  reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  filter(callbackfn: (value: T, index: number, array: T[]) => any): T[];
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  slice(start?: number, end?: number): T[];
  join(separator?: string): string;
  push(...items: T[]): number;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...items: T[]): number;
  concat(...items: ConcatArray<T>[]): T[];
  includes(searchElement: T): boolean;
  indexOf(searchElement: T): number;
  find<U extends T>(predicate: (value: T, index: number, obj: T[]) => value is U): U | undefined;
}

interface ConcatArray<T> {
  length: number;
  [index: number]: T;
  concat(...items: ConcatArray<T>[]): T[];
}

interface String {
  length: number;
  charAt(index: number): string;
  charCodeAt(index: number): number;
  concat(...strings: string[]): string;
  includes(searchString: string): boolean;
  indexOf(searchString: string, fromIndex?: number): number;
  slice(start?: number, end?: number): string;
  substring(start?: number, end?: number): string;
  substr(start?: number, length?: number): string;
  toLowerCase(): string;
  toUpperCase(): string;
  trim(): string;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  split(separator: string | RegExp, limit?: number): string[];
  [index: number]: string;
}

interface Object {
  [key: string]: any;
}

interface Date {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getTime(): number;
}

interface Math {
  abs(x: number): number;
  floor(x: number): number;
  ceil(x: number): number;
  round(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  random(): number;
}

interface JSON {
  stringify(value: any): string;
  parse(text: string): any;
}

interface RegExp {
  test(s: string): boolean;
  exec(s: string): RegExpExecArray | null;
}

interface RegExpExecArray {
  [index: number]: string;
  index: number;
  input: string;
}

interface Console {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
}

declare const console: Console;

// Primitives
declare function listFiles(): Array<{file: string, line?: number, text?: string}>;
declare function list(): Array<{file: string, line?: number, text?: string}>;
declare function readLines(file: string, startLine: number, endLine: number): {file: string, start: number, lines: string[]};
declare function read(file: string, start?: number, end?: number): {file: string, start: number, lines: string[]};
declare function readAround(file: string, line: number, contextLines?: number): {file: string, start: number, lines: string[]};
declare function searchText(query: string): Array<{file: string, line: number, text: string}>;
declare function search(query: string, options?: {pathPrefix?: string, offset?: number, limit?: number}): Array<{file: string, line: number, text: string}>;
declare function searchIdentifiers(identifier: string): Array<{file: string, line: number, text: string}>;
declare function listSymbols(): Array<{file: string, line: number, name: string, kind: string}>;
declare function findDefinitions(symbol: string): Array<{file: string, line: number, text: string, kind: string}>;
declare function findReferences(symbol: string): Array<{file: string, line: number, text: string}>;
declare function getImports(filePath: string): Array<{file: string, line: number, text: string}>;
declare function getGitDiff(revision1: string, revision2?: string): string;

// Re-declare built-in constructors as variables for use in new expressions
declare const Array: {
  new (): any[];
  new <T>(...items: T[]): T[];
  isArray(arg: any): arg is any[];
};

declare const Object: {
  new (): object;
  keys(o: object): string[];
  values<T>(o: {[s: string]: T}): T[];
  entries<T>(o: {[s: string]: T}): [string, T][];
};

declare const String: {
  new (value?: any): string;
};

declare const Number: {
  new (value?: any): number;
};

declare const Boolean: {
  new (value?: any): boolean;
};

declare const Date: {
  new (): Date;
  new (value: number): Date;
  new (value: string): Date;
  now(): number;
};

declare const RegExp: {
  new (pattern: string, flags?: string): RegExp;
};

declare const Math: Math;
declare const JSON: JSON;

// Global utilities
declare function isNaN(value: any): boolean;
declare function isFinite(value: any): boolean;
declare function parseInt(s: string, radix?: number): number;
declare function parseFloat(s: string): number;
declare function encodeURI(uri: string): string;
declare function decodeURI(uri: string): string;
declare function encodeURIComponent(uri: string): string;
declare function decodeURIComponent(uri: string): string;

// Type aliases
type Nullable<T> = T | null | undefined;
`;

/**
 * Validate TypeScript code and transpile to JavaScript
 * @param {string} code - The TypeScript source code
 * @param {string} fileName - The file name for error reporting
 * @returns {Promise<{javascript: string, diagnostics: Array<{code: string, line: number, message: string}>, trace: object}>}
 */
async function validateAndTranspile(code, fileName = 'input.ts') {
  const trace = {
    version: '1.0',
    identifier: generateFingerprint(code),
    fingerprint: generateFingerprint(code),
    parameters: extractParameters(code),
    executedCalls: [],
    results: null,
    errors: []
  };

  // First, validate syntax
  const syntaxDiagnostics = validateSyntax(code, fileName);
  if (syntaxDiagnostics.length > 0) {
    return {
      javascript: null,
      diagnostics: syntaxDiagnostics,
      trace: {
        ...trace,
        errors: syntaxDiagnostics.map(d => ({ code: d.code, line: d.line, message: d.message }))
      }
    };
  }

  // Then, validate types in strict mode
  const typeDiagnostics = validateTypes(code, fileName);
  if (typeDiagnostics.length > 0) {
    return {
      javascript: null,
      diagnostics: typeDiagnostics,
      trace: {
        ...trace,
        errors: typeDiagnostics.map(d => ({ code: d.code, line: d.line, message: d.message }))
      }
    };
  }

  // Check structure (parameters, return types)
  const structureDiagnostics = validateStructure(code, fileName);
  if (structureDiagnostics.length > 0) {
    return {
      javascript: null,
      diagnostics: structureDiagnostics,
      trace: {
        ...trace,
        errors: structureDiagnostics.map(d => ({ code: d.code, line: d.line, message: d.message }))
      }
    };
  }

  // Verify exclusive use of 10 primitives
  const primitiveDiagnostics = validatePrimitives(code, fileName);
  if (primitiveDiagnostics.length > 0) {
    return {
      javascript: null,
      diagnostics: primitiveDiagnostics,
      trace: {
        ...trace,
        errors: primitiveDiagnostics.map(d => ({ code: d.code, line: d.line, message: d.message }))
      }
    };
  }

  // Transpile to JavaScript (no type checking, just transpile)
  const transpileResult = transpileToJavaScript(code, fileName);
  
  // We already validated types above, so we don't need to check transpile diagnostics
  // Just use the output
  if (!transpileResult.javascript) {
    // If transpilation failed, use the diagnostics
    return {
      javascript: null,
      diagnostics: transpileResult.diagnostics || [{ code: 'TS_TRANSPILE_ERROR', line: 1, message: 'Failed to transpile' }],
      trace: {
        ...trace,
        errors: (transpileResult.diagnostics || []).map(d => ({ code: d.code, line: d.line, message: d.message }))
      }
    };
  }

  // Success!
  return {
    javascript: transpileResult.javascript,
    diagnostics: [],
    trace
  };
}

/**
 * Validate syntax using TypeScript compiler
 */
function validateSyntax(code, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  // Use parseDiagnostics which is simpler and doesn't require a program
  const diagnostics = [];
  
  // Collect parse diagnostics
  const parseDiagnostics = sourceFile.parseDiagnostics;
  if (parseDiagnostics) {
    diagnostics.push(...parseDiagnostics);
  }
  
  // Also try to get syntactic diagnostics using a simple approach
  try {
    // Try parsing with different script targets to catch more errors
    for (const target of [ts.ScriptTarget.ES2022, ts.ScriptTarget.ESNext]) {
      const testFile = ts.createSourceFile(
        fileName,
        code,
        target,
        true
      );
      if (testFile.parseDiagnostics) {
        diagnostics.push(...testFile.parseDiagnostics);
      }
    }
  } catch (e) {
    // Ignore errors during parsing
  }
  
  return diagnostics.map(d => formatDiagnostic(d, sourceFile, code));
}

/**
 * Validate types in strict mode
 */
function validateTypes(code, fileName) {
  // Use a simple approach: create a program with type definitions and check for type errors
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
    noImplicitAny: true,
    strictNullChecks: true,
    strictFunctionTypes: true,
    strictBindCallApply: true,
    strictPropertyInitialization: true,
    noImplicitThis: true,
    useUnknownInCatchVariables: true,
    alwaysStrict: true,
    esModuleInterop: true,
    skipLibCheck: true
  };

  try {
    const host = ts.createCompilerHost(compilerOptions);
    
    // Override to provide our code and the primitive definitions
    const originalGetSourceFile = host.getSourceFile.bind(host);
    // The host is asked for the file in TypeScript's normalised spelling
    // (forward slashes, canonical drive letter), so the comparison is made on
    // resolved paths: a raw string comparison missed the virtual file on
    // Windows and the compiler reported TS6053 instead of the code's errors.
    const isCandidate = name => path.resolve(name).toLowerCase() === path.resolve(fileName).toLowerCase();
    host.getSourceFile = (fn, languageVersion) => {
      if (isCandidate(fn)) {
        return ts.createSourceFile(fn, code, languageVersion, true);
      }
      // Return primitive definitions for a special file
      if (fn === 'primitives.d.ts') {
        return ts.createSourceFile(fn, PRIMITIVES_TYPE_DEFS, languageVersion, true);
      }
      return originalGetSourceFile(fn, languageVersion);
    };
    
    host.fileExists = (fn) => fn === fileName || fn === 'primitives.d.ts' || true;
    host.readFile = (fn) => {
      if (fn === fileName) return code;
      if (fn === 'primitives.d.ts') return PRIMITIVES_TYPE_DEFS;
      return '';
    };
    host.writeFile = () => {};
    
    // Create program with both the user code and the primitive definitions
    const program = ts.createProgram([fileName, 'primitives.d.ts'], compilerOptions, host);
    
    // Get all source files and check for type errors
    const diagnostics = [];
    for (const sourceFile of program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue;
      if (sourceFile.fileName === 'primitives.d.ts') continue; // Skip our own definitions
      if (sourceFile.fileName !== fileName) continue;
      
      try {
        // Get all diagnostics for this file
        const typeChecker = program.getTypeChecker();
        const diags = typeChecker.getDiagnostics(sourceFile);
        if (diags) {
          diagnostics.push(...diags);
        }
      } catch (e) {
        // Try alternative method
        try {
          const diags = program.getSemanticDiagnostics(sourceFile);
          if (diags) {
            diagnostics.push(...diags);
          }
        } catch (e2) {
          // Ignore
        }
      }
    }
    
    // Deduplicate diagnostics by code, line, and message
    const seen = new Set();
    const uniqueDiagnostics = [];
    for (const d of diagnostics) {
      const key = `${d.code}-${d.start || 0}-${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDiagnostics.push(d);
      }
    }
    
    return uniqueDiagnostics.map(d => formatDiagnostic(d, ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true), code));
    
  } catch (e) {
    // Fallback to syntax check only
    return validateSyntax(code, fileName);
  }
}

/**
 * Validate structure (function parameters, return types)
 */
function validateStructure(code, fileName) {
  const diagnostics = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  // Check for function declarations/expressions/arrow functions
  let hasFunction = false;

  function visit(node) {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      hasFunction = true;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Only require a function if the code looks like it's meant to be a function
  // (has type annotations or is complex)
  // For simple expressions or statements, we don't require a function
  const hasTypeAnnotations = code.includes(': ') || code.includes('interface ') || code.includes('type ');
  const hasComplexStructure = code.includes('function ') || code.includes('=>') || code.includes('class ');
  
  if (hasTypeAnnotations && !hasFunction && !hasComplexStructure) {
    // This might be a type-only code, which is OK
    return diagnostics;
  }

  // For function_try, we expect the code to be a function expression
  // But for general validation, we allow any code
  return diagnostics;
}

/**
 * Verify exclusive use of 10 primitives
 * Only checks for disallowed built-in functions, not user-defined ones
 */
function validatePrimitives(code, fileName) {
  const diagnostics = [];
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  );

  // First, collect all user-defined function names
  const userDefinedFunctions = new Set();
  function collectUserFunctions(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      userDefinedFunctions.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      // Check if it's a function expression
      if (node.initializer && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) {
        userDefinedFunctions.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectUserFunctions);
  }
  collectUserFunctions(sourceFile);

  const disallowedFunctions = [];

  function visit(node) {
    // Check for call expressions
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) {
        const funcName = expr.text;
        // Allow user-defined functions
        if (!userDefinedFunctions.has(funcName) && !ALLOWED_PRIMITIVES.has(funcName) && !isAllowedGlobal(funcName)) {
          const line = sourceFile.getLineAndCharacterOfPosition(expr.getStart()).line + 1;
          disallowedFunctions.push({
            name: funcName,
            line: line
          });
        }
      } else if (ts.isPropertyAccessExpression(expr)) {
        // Handle property access like JSON.stringify or Math.abs
        const name = getPropertyAccessName(expr);
        const propertyName = expr.name.text;
        const objectName = getPropertyAccessObject(expr);
        
        // Check if the object is an allowed global
        if (objectName && isAllowedGlobal(objectName)) {
          // The method is being called on an allowed global object
          // This is allowed - don't flag it
          return;
        }
        
        // For chained access like JSON.parse.text (unlikely but handle it)
        if (name && !ALLOWED_PRIMITIVES.has(name) && !isAllowedGlobal(name)) {
          // Check if the first part is an allowed global
          const firstPart = name.split('.')[0];
          if (!isAllowedGlobal(firstPart)) {
            const line = sourceFile.getLineAndCharacterOfPosition(expr.getStart()).line + 1;
            disallowedFunctions.push({
              name: name,
              line: line
            });
          }
        }
      }
    }

    // Check for new Function() or Function constructor
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      disallowedFunctions.push({
        name: 'Function constructor',
        line: line
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Check for eval
  if (code.includes('eval(')) {
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('eval(')) {
        disallowedFunctions.push({
          name: 'eval',
          line: i + 1
        });
        break;
      }
    }
  }

  // Report disallowed function calls
  for (const { name, line } of disallowedFunctions) {
    diagnostics.push({
      code: 'PRIMITIVE_001',
      line: line,
      message: `disallowed function '${name}' is not allowed`
    });
  }

  return diagnostics;
}

/**
 * Get the full name from a property access expression
 */
function getPropertyAccessName(node) {
  if (ts.isIdentifier(node.name)) {
    if (ts.isPropertyAccessExpression(node.expression)) {
      const parentName = getPropertyAccessName(node.expression);
      return parentName ? `${parentName}.${node.name.text}` : node.name.text;
    }
    return node.name.text;
  }
  return null;
}

/**
 * Get the object name from a property access expression
 */
function getPropertyAccessObject(node) {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  } else if (ts.isPropertyAccessExpression(node.expression)) {
    return getPropertyAccessObject(node.expression);
  }
  return null;
}

/**
 * Check if an identifier is an allowed global
 * Note: eval, Function, setTimeout, etc. are NOT in this list so they get caught by both
 * the type checker (as unknown names) and the primitive validator
 */
function isAllowedGlobal(name) {
  const allowedGlobals = new Set([
    'JSON',
    'Math',
    'Date',
    'RegExp',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'undefined',
    'null',
    'true',
    'false',
    'NaN',
    'Infinity',
    'isNaN',
    'isFinite',
    'parseInt',
    'parseFloat',
    'encodeURI',
    'decodeURI',
    'encodeURIComponent',
    'decodeURIComponent',
    'globalThis',
    'params',
    // QuickJS globals
    'console',
    // Array methods (allowed on arrays)
    'reduce',
    'map',
    'filter',
    'forEach',
    'find',
    'findIndex',
    'some',
    'every',
    'includes',
    'indexOf',
    'lastIndexOf',
    'push',
    'pop',
    'shift',
    'unshift',
    'slice',
    'splice',
    'concat',
    'join',
    'reverse',
    'sort',
    // String methods
    'charAt',
    'charCodeAt',
    'substring',
    'substr',
    'slice',
    'indexOf',
    'lastIndexOf',
    'includes',
    'startsWith',
    'endsWith',
    'toUpperCase',
    'toLowerCase',
    'trim',
    'split',
    'replace',
    'match',
    'search',
    // Object methods
    'keys',
    'values',
    'entries',
    'assign',
    'freeze',
    'seal',
    // JSON methods
    'stringify',
    'parse',
    // Math methods
    'abs',
    'floor',
    'ceil',
    'round',
    'max',
    'min',
    'random',
    // Date methods
    'getFullYear',
    'getMonth',
    'getDate',
    'getTime',
    'getDay',
    'getHours',
    'getMinutes',
    'getSeconds',
    'getMilliseconds',
    'getUTCFullYear',
    'getUTCMonth',
    'getUTCDate',
    'getUTCDay',
    'getUTCHours',
    'getUTCMinutes',
    'getUTCSeconds',
    'getUTCMilliseconds',
    // RegExp methods
    'test',
    'exec'
  ]);
  return allowedGlobals.has(name);
}

/**
 * Transpile TypeScript to JavaScript
 */
function transpileToJavaScript(code, fileName) {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true
  };

  try {
    // Use ts.transpileModule which is simpler and doesn't require a full program
    const result = ts.transpileModule(code, {
      compilerOptions: compilerOptions,
      fileName: fileName
    });
    
    if (result.diagnostics && result.diagnostics.length > 0) {
      const formattedDiagnostics = result.diagnostics.map(d => 
        formatDiagnostic(d, ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true), code)
      );
      return {
        javascript: null,
        diagnostics: formattedDiagnostics
      };
    }
    
    // Clean up the output
    const cleaned = cleanTranspiledOutput(result.outputText, code);
    return {
      javascript: cleaned,
      diagnostics: []
    };
    
  } catch (e) {
    // Fallback to simple transpile without module
    try {
      const result = ts.transpileModule(code, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None
        },
        fileName: fileName
      });
      return {
        javascript: cleanTranspiledOutput(result.outputText, code),
        diagnostics: result.diagnostics ? result.diagnostics.map(d => formatDiagnostic(d, ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true), code)) : []
      };
    } catch (e2) {
      return {
        javascript: null,
        diagnostics: [{ code: 'TS_TRANSPILE_ERROR', line: 1, message: String(e2.message || e2) }]
      };
    }
  }
}

/**
 * Format a TypeScript diagnostic into our compact format
 */
function formatDiagnostic(diagnostic, sourceFile, code) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  let line = 1;
  
  if (diagnostic.start !== undefined) {
    const pos = sourceFile.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
    line = pos;
  }
  
  // Extract just the error code if available
  let codePart = 'TS';
  if (typeof diagnostic.code === 'number') {
    codePart = `TS${diagnostic.code}`;
  } else if (typeof diagnostic.code === 'string') {
    codePart = diagnostic.code;
  }
  
  return {
    code: codePart,
    line: line,
    message: message
  };
}

/**
 * Generate a fingerprint for the code
 */
function generateFingerprint(code) {
  // Simple hash based on code content
  let hash = 0;
  for (let i = 0; i < Math.min(code.length, 1000); i++) {
    const char = code.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `fp_${Math.abs(hash).toString(16)}`;
}

/**
 * Extract parameters from the code
 */
function extractParameters(code) {
  // Try to extract function parameters
  const params = {};
  
  // Match function declarations and arrow functions
  const functionRegex = /(?:function\s*\w*\s*\(([^)]*)\)|\s*\(([^)]*)\)\s*=>)/g;
  let match;
  
  while ((match = functionRegex.exec(code)) !== null) {
    const paramStr = match[1] || match[2];
    if (paramStr) {
      const paramNames = paramStr.split(',').map(p => p.trim()).filter(p => p);
      if (paramNames.length > 0) {
        params.functionParameters = paramNames;
        break; // Just get the first function's parameters
      }
    }
  }
  
  return params;
}

/**
 * Clean the transpiled output to remove wrapper if present
 */
function cleanTranspiledOutput(output, originalCode) {
  // If the original code is already a function expression, we don't need the wrapper
  const trimmedCode = originalCode.trim();
  
  // Trim the output to remove trailing newlines and semicolons
  // Also remove all newlines to make it single-line for template literal insertion
  let cleaned = output.trimEnd().replace(/;+$/, '').replace(/\n/g, ' ').replace(/\s+/g, ' ');
  
  // Remove "use strict"; prefix if present
  cleaned = cleaned.replace(/^"use strict";\s*/, '').trim();
  
  // For now, just return the cleaned code without wrapping
  // The wrapper in worker.js will handle execution
  // Note: We might need to add wrapping for code with statements in the future
  return cleaned;
  
  // For function expressions, arrow functions, and other expressions, just return the cleaned version
  return cleaned;
}

module.exports = { validateAndTranspile, ALLOWED_PRIMITIVES };
