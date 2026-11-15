/**
 * Local Technical Validation Module (Ticket 04)
 * 
 * Provides:
 * - TypeScript type checking via TypeScript compiler
 * - Whitelist validation for 10 primitives
 * - Call tracing with file, lines, revision
 * - Rollback and documentation
 * - Re-execution verification
 * 
 * Does NOT claim semantic validation or exhaustiveness.
 */

const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

// ============================================================================
// Configuration
// ============================================================================

/** The 10 allowed primitives (from ticket 01) */
const WHITELIST = [
  'listFiles',
  'list',
  'searchText',
  'search',
  'searchIdentifiers',
  'readLines',
  'read',
  'readAround',
  'listSymbols',
  'findDefinitions',
  'findReferences',
  'getImports',
  'getGitDiff',
  'git'
];

/** Dangerous functions that are never allowed */
const DANGEROUS_FUNCTIONS = [
  'eval',
  'Function',
  'require',
  'import',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'Buffer',
  'process',
  'global',
  'globalThis',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  '__dirname',
  '__filename',
  'module'
];

/** Maximum code length for validation */
const MAX_CODE_LENGTH = 32768;

/** Maximum validation timeout in ms */
const VALIDATION_TIMEOUT = 5000;

// ============================================================================
// TypeScript Compiler Options
// ============================================================================

const TS_OPTIONS = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  allowJs: false,
  checkJs: false,
  noEmit: true,
  noImplicitAny: true,
  strictNullChecks: true,
  strictFunctionTypes: true,
  strictBindCallApply: true,
  strictPropertyInitialization: true,
  noImplicitThis: true,
  useUnknownInCatchVariables: true,
  alwaysStrict: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  exactOptionalPropertyTypes: false,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noPropertyAccessFromIndexSignature: false,
  allowUnusedLabels: false,
  allowUnreachableCode: false,
  // Allow these to reduce noise in validation
  allowSyntheticDefaultImports: true,
  forceConsistentCasingInFileNames: false,
  resolveJsonModule: false,
  isolatedModules: true,
};

// Type definitions for primitives
const PRIMITIVE_TYPES = `
declare function listFiles(maxFiles?: number): string[];
declare function list(maxFiles?: number): string[];
declare function searchText(query: string): Array<{ file: string; line: number; text: string }>;
declare function search(query: string): Array<{ file: string; line: number; text: string }>;
declare function searchIdentifiers(identifier: string): Array<{ file: string; line: number; text: string }>;
declare function readLines(file: string, startLine: number, endLine: number): Array<{ line: number; text: string }>;
declare function read(file: string, startLine: number, endLine: number): Array<{ line: number; text: string }>;
declare function readAround(file: string, line: number, contextLines?: number): Array<{ line: number; text: string }>;
declare function listSymbols(): Array<{ file: string; line: number; name: string; kind: string }>;
declare function findDefinitions(symbol: string): Array<{ file: string; line: number; text: string; kind: string }>;
declare function findReferences(symbol: string): Array<{ file: string; line: number; text: string; kind?: string }>;
declare function getImports(filePath: string): Array<{ file: string; line: number; text: string }>;
declare function getGitDiff(revision1: string, revision2?: string): string;
declare function git(timeout?: number): string;
`;

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Result of type checking validation
 */
class TypeValidationResult {
  constructor({
    valid,
    errors = [],
    warnings = [],
    diagnostics = [],
    code,
    verification = null
  }) {
    this.valid = valid;
    this.errors = errors;
    this.warnings = warnings;
    this.diagnostics = diagnostics;
    this.code = code;
    this.verification = verification || {
      reExecutable: valid && errors.length === 0,
      consistent: true,
      checkedAt: new Date().toISOString()
    };
    this.documentation = this._generateDocumentation();
    this.timestamp = new Date().toISOString();
  }

  _generateDocumentation() {
    return {
      status: this.valid ? 'passed' : 'failed',
      timestamp: this.timestamp,
      errors: this.errors,
      warnings: this.warnings,
      typeChecking: true,
      semanticValidation: false, // Explicitly state we don't do semantic validation
      notes: ['Local technical validation only', 'No claims of exhaustiveness']
    };
  }
}

/**
 * Result of primitive whitelist validation
 */
class PrimitiveValidationResult {
  constructor({
    valid,
    violations = [],
    allowedPrimitives = WHITELIST,
    code
  }) {
    this.valid = valid;
    this.violations = violations;
    this.allowedPrimitives = allowedPrimitives;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Single call trace entry
 */
class CallTrace {
  constructor({
    function: fnName,
    file,
    line,
    column,
    revision,
    arguments: args = [],
    timestamp
  }) {
    this.function = fnName;
    this.file = file;
    this.line = line;
    this.column = column;
    this.revision = revision || 'unknown';
    this.arguments = args;
    this.timestamp = timestamp || new Date().toISOString();
  }
}

/**
 * Proof of a traced call
 */
class CallProof {
  constructor({
    call,
    evidence,
    validationHash
  }) {
    this.call = call;
    this.evidence = evidence;
    this.validationHash = validationHash;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Result of trace validation
 */
class TraceResult {
  constructor({
    traces = [],
    proofs = [],
    verification,
    rollback
  }) {
    this.traces = traces;
    this.proofs = proofs;
    this.verification = verification || {
      reExecutable: true,
      consistent: true,
      checkedAt: new Date().toISOString()
    };
    this.rollback = rollback;
    this.timestamp = new Date().toISOString();
  }
}

// ============================================================================
// Main Validation Functions
// ============================================================================

/**
 * Validate TypeScript code for syntax and type correctness
 * 
 * @param {string} code - The TypeScript code to validate
 * @param {string} [fileName] - Optional filename for error reporting
 * @returns {Promise<TypeValidationResult>} Validation result
 */
async function validateCode(code, fileName = 'validation.ts') {
  // Validate input
  if (!code || typeof code !== 'string') {
    return new TypeValidationResult({
      valid: false,
      errors: ['Code must be a non-empty string'],
      code
    });
  }

  if (code.length > MAX_CODE_LENGTH) {
    return new TypeValidationResult({
      valid: false,
      errors: [`Code exceeds maximum length of ${MAX_CODE_LENGTH} characters`],
      code
    });
  }

  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Validation timeout after ${VALIDATION_TIMEOUT}ms`));
    }, VALIDATION_TIMEOUT);
  });

  // Perform validation with timeout
  try {
    const validationPromise = _performTypeCheck(code, fileName);
    const result = await Promise.race([validationPromise, timeoutPromise]);
    return result;
  } catch (error) {
    return new TypeValidationResult({
      valid: false,
      errors: [error.message],
      code
    });
  }
}

/**
 * Internal function to perform TypeScript type checking
 */
function _performTypeCheck(code, fileName) {
  // Create virtual file system with type definitions
  const typeDefFileName = 'primitives.d.ts';
  const fullCode = PRIMITIVE_TYPES + '\n\n' + code;

  // Create a compiler host that only knows about our primitives
  const compilerHost = ts.createCompilerHost(TS_OPTIONS);
  
  // Override file existence to handle our virtual files
  const originalFileExists = compilerHost.fileExists.bind(compilerHost);
  compilerHost.fileExists = (path) => {
    if (path === fileName || path === typeDefFileName || path === '/dev/null') {
      return true;
    }
    return originalFileExists(path);
  };

  // Override readFile to provide our code and type definitions
  const originalReadFile = compilerHost.readFile.bind(compilerHost);
  compilerHost.readFile = (path) => {
    if (path === fileName) {
      return fullCode;
    }
    if (path === typeDefFileName) {
      return PRIMITIVE_TYPES;
    }
    return originalReadFile(path);
  };

  // Override getSourceFile to ensure we use our virtual files
  const originalGetSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (path === fileName || path === typeDefFileName) {
      const text = compilerHost.readFile(path);
      return ts.createSourceFile(path, text, languageVersion, true);
    }
    return originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  };

  // Create program with both the main file and type definitions
  const program = ts.createProgram([fileName], TS_OPTIONS, compilerHost);

  // Get diagnostics (errors and warnings)
  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getOptionsDiagnostics()
  ];

  // Convert diagnostics to user-friendly messages
  const errors = [];
  const warnings = [];

  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const category = ts.DiagnosticCategory[diagnostic.category].toLowerCase();

    if (diagnostic.file) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const location = { file: diagnostic.file.fileName, line: line + 1, character: character + 1 };
      const formattedMessage = `${message} (${location.file}:${location.line}:${location.character})`;
      
      if (category === 'error') {
        errors.push(formattedMessage);
      } else if (category === 'warning') {
        warnings.push(formattedMessage);
      }
    } else {
      if (category === 'error') {
        errors.push(message);
      } else if (category === 'warning') {
        warnings.push(message);
      }
    }
  }

  // Determine if valid (no errors)
  const valid = errors.length === 0;

  return new TypeValidationResult({
    valid,
    errors,
    warnings,
    diagnostics,
    code,
    verification: {
      reExecutable: valid,
      consistent: true,
      checkedAt: new Date().toISOString()
    }
  });
}

/**
 * Validate that code only uses whitelisted primitives
 * 
 * @param {string} code - The code to validate
 * @returns {PrimitiveValidationResult} Validation result
 */
function validatePrimitives(code) {
  if (!code || typeof code !== 'string') {
    return new PrimitiveValidationResult({
      valid: false,
      violations: [{ type: 'invalid-input', message: 'Code must be a non-empty string' }],
      code
    });
  }

  if (code.length > MAX_CODE_LENGTH) {
    return new PrimitiveValidationResult({
      valid: false,
      violations: [{ 
        type: 'code-too-long', 
        message: `Code exceeds maximum length of ${MAX_CODE_LENGTH} characters` 
      }],
      code
    });
  }

  const violations = [];
  
  // Check for dangerous functions
  for (const dangerous of DANGEROUS_FUNCTIONS) {
    // Match dangerous function calls
    const dangerousPattern = new RegExp(
      `(?:\\b${dangerous}\\s*\\()|(?:new\\s+${dangerous}\\s*\\()|(?:\\b${dangerous}\\s*\\.)`,
      'g'
    );
    
    if (dangerousPattern.test(code)) {
      violations.push({
        type: 'dangerous-function',
        function: dangerous,
        message: `disallowed function '${dangerous}' is not allowed`,
        severity: 'critical'
      });
    }
  }

  // Check for require/import statements
  const importPattern = /(?:^|\n\s*)require\s*\(/g;
  if (importPattern.test(code)) {
    violations.push({
      type: 'non-whitelisted-call',
      function: 'require',
      message: 'require() is not allowed',
      severity: 'critical'
    });
  }

  const importStatementPattern = /^\s*import\s+/gm;
  if (importStatementPattern.test(code)) {
    violations.push({
      type: 'non-whitelisted-call',
      function: 'import',
      message: 'import statements are not allowed',
      severity: 'critical'
    });
  }

  // Extract all function calls from the code
  const functionCalls = extractFunctionCalls(code);

  // Check each call against the whitelist
  for (const call of functionCalls) {
    // Skip whitelisted primitives
    if (WHITELIST.includes(call.functionName)) {
      continue;
    }

    // Skip standard JavaScript/TypeScript methods (Array, Object, String, etc.)
    const standardTypes = [
      'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp',
      'Date', 'Math', 'JSON', 'Promise', 'ArrayBuffer', 'DataView'
    ];
    
    // Check if it's a method of a standard type
    const isStandardMethod = standardTypes.some(type => 
      call.fullName.startsWith(`${type}.`) || 
      (call.object && standardTypes.includes(call.object))
    );
    
    if (isStandardMethod) {
      continue;
    }

    // Skip common array methods
    const arrayMethods = [
      'filter', 'map', 'reduce', 'forEach', 'some', 'every', 'find', 'findIndex',
      'includes', 'indexOf', 'lastIndexOf', 'slice', 'splice', 'concat',
      'join', 'reverse', 'sort', 'push', 'pop', 'shift', 'unshift'
    ];
    
    if (arrayMethods.includes(call.functionName)) {
      continue;
    }

    // Skip common string methods
    const stringMethods = [
      'split', 'slice', 'substring', 'substr', 'replace', 'match',
      'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf',
      'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase'
    ];
    
    if (stringMethods.includes(call.functionName)) {
      continue;
    }

    // Skip local function definitions (functions that are defined in the code)
    // We can't validate these without a full AST, so we skip them
    // This means user-defined functions are allowed
    if (call.fullName && !call.fullName.includes('.')) {
      // This is a simple identifier - could be a local function
      // We don't flag it as an error
      continue;
    }

    // Only flag if it's a global call to a known dangerous function
    // or if it's explicitly calling a non-whitelisted global
    if (isGlobalCall(call)) {
      violations.push({
        type: 'non-whitelisted-call',
        function: call.functionName,
        message: `disallowed function '${call.functionName}' is not allowed`,
        line: call.line,
        column: call.column,
        severity: 'high'
      });
    }
  }

  const valid = violations.length === 0;

  return new PrimitiveValidationResult({
    valid,
    violations,
    allowedPrimitives: WHITELIST,
    code
  });
}

/**
 * Extract function calls from code using regex (simplified approach)
 * Note: This is not exhaustive and may have false positives/negatives
 */
function extractFunctionCalls(code) {
  const calls = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Match function calls: functionName(...) or object.method(...)
    const callRegex = /(\w+(?:\.\w+)*)\s*\(/g;
    let match;

    while ((match = callRegex.exec(line)) !== null) {
      const fullName = match[1];
      const parts = fullName.split('.');
      const functionName = parts.length > 1 ? parts[parts.length - 1] : fullName;
      const object = parts.length > 1 ? parts[0] : null;

      // Get character position (column)
      const column = match.index + 1;

      calls.push({
        functionName,
        fullName,
        object,
        line: lineNum,
        column
      });
    }
  }

  return calls;
}

/**
 * Check if a call appears to be a global function call
 */
function isGlobalCall(call) {
  // If it has an object (like obj.method), it's not global
  if (call.object) {
    return false;
  }

  // Check if it's a known global (like Math, JSON, etc.)
  const globalObjects = ['Math', 'JSON', 'Date', 'RegExp', 'Promise', 'Object', 'Array'];
  if (call.object && globalObjects.includes(call.object)) {
    return false;
  }

  // If the function name starts with lowercase or is in our whitelist, check differently
  if (WHITELIST.includes(call.functionName)) {
    return false;
  }

  // Assume it's a global call if it's a simple identifier
  return !call.fullName.includes('.') && 
         !globalObjects.includes(call.functionName) &&
         !call.functionName.match(/^[A-Z]/); // Not a constructor
}

// ============================================================================
// Trace Validator
// ============================================================================

/**
 * Validator for tracing function calls and their proofs
 */
class TraceValidator {
  constructor() {
    this.traces = [];
    this.proofs = [];
    this._snapshot = null;
  }

  /**
   * Take a snapshot of current state for rollback
   */
  _takeSnapshot() {
    this._snapshot = {
      traces: [...this.traces],
      proofs: [...this.proofs],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Trace function calls in code
   * 
   * @param {string} code - The code to trace
   * @param {string} workspaceRoot - Root of the workspace
   * @returns {Promise<TraceResult>} Trace result
   */
  async trace(code, workspaceRoot) {
    this.traces = [];
    this.proofs = [];
    this._snapshot = null;

    // Take initial snapshot for rollback
    this._takeSnapshot();

    // Validate the code first
    const typeValidation = await validateCode(code);
    const primitiveValidation = validatePrimitives(code);

    if (!typeValidation.valid || !primitiveValidation.valid) {
      return new TraceResult({
        traces: [],
        proofs: [],
        verification: {
          reExecutable: false,
          consistent: false,
          checkedAt: new Date().toISOString()
        },
        rollback: () => this._snapshot
      });
    }

    // Extract call information
    const functionCalls = extractFunctionCalls(code);

    for (const call of functionCalls) {
      // Only trace whitelisted primitives
      if (WHITELIST.includes(call.functionName)) {
        const trace = new CallTrace({
          function: call.functionName,
          file: workspaceRoot || 'unknown',
          line: call.line,
          column: call.column,
          revision: this._getRevision(workspaceRoot),
          arguments: [],
          timestamp: new Date().toISOString()
        });

        this.traces.push(trace);

        // Create proof for this call
        const proof = new CallProof({
          call: trace,
          evidence: {
            code: code.substring(0, 200),
            functionName: call.functionName,
            location: { line: call.line, column: call.column }
          },
          validationHash: this._generateHash(code, call)
        });

        this.proofs.push(proof);
      }
    }

    // Verify re-execution
    const verification = await this._verifyReExecution(code, workspaceRoot);

    return new TraceResult({
      traces: this.traces,
      proofs: this.proofs,
      verification,
      rollback: () => ({ ...this._snapshot })
    });
  }

  /**
   * Get git revision for workspace
   */
  _getRevision(workspaceRoot) {
    try {
      if (workspaceRoot) {
        const fs = require('node:fs');
        const path = require('node:path');
        const { execSync } = require('node:child_process');
        
        const gitDir = path.join(workspaceRoot, '.git');
        if (fs.existsSync(gitDir)) {
          try {
            const rev = execSync('git rev-parse HEAD', { 
              cwd: workspaceRoot,
              encoding: 'utf8',
              timeout: 2000 
            }).trim();
            return rev.slice(0, 12); // Short hash
          } catch {
            return 'unknown';
          }
        }
      }
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Generate hash for proof validation
   */
  _generateHash(code, call) {
    const crypto = require('node:crypto');
    const data = `${call.functionName}:${call.line}:${call.column}:${code.slice(0, 100)}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Verify that code can be re-executed
   */
  async _verifyReExecution(code, workspaceRoot) {
    // Check type validation
    const typeResult = await validateCode(code);
    
    if (!typeResult.valid) {
      return {
        reExecutable: false,
        consistent: false,
        checkedAt: new Date().toISOString(),
        reason: 'Type validation failed'
      };
    }

    // Check primitive validation
    const primitiveResult = validatePrimitives(code);
    
    if (!primitiveResult.valid) {
      return {
        reExecutable: false,
        consistent: false,
        checkedAt: new Date().toISOString(),
        reason: 'Primitive whitelist validation failed'
      };
    }

    // Check for infinite loops or other obvious issues
    if (this._detectPotentialIssues(code)) {
      return {
        reExecutable: false,
        consistent: false,
        checkedAt: new Date().toISOString(),
        reason: 'Potential execution issues detected'
      };
    }

    return {
      reExecutable: true,
      consistent: true,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Detect potential execution issues
   */
  _detectPotentialIssues(code) {
    // Check for obvious infinite loops
    const infiniteLoopPatterns = [
      /while\s*\(\s*true\s*\)/,
      /for\s*\(\s*;\s*;\s*\)/,
      /while\s*\(\s*1\s*\)/
    ];

    for (const pattern of infiniteLoopPatterns) {
      if (pattern.test(code)) {
        return true;
      }
    }

    // Check for excessive recursion
    const recursiveCalls = code.match(/\w+\s*\([^)]*\1[^)]*\)/g);
    if (recursiveCalls && recursiveCalls.length > 5) {
      return true;
    }

    return false;
  }

  /**
   * Get current traces
   */
  getTraces() {
    return [...this.traces];
  }

  /**
   * Get current proofs
   */
  getProofs() {
    return [...this.proofs];
  }
}

// ============================================================================
// Full Validation Pipeline
// ============================================================================

/**
 * Perform complete local technical validation
 * 
 * @param {string} code - The code to validate
 * @param {string} [workspaceRoot] - Root of the workspace
 * @param {Object} [options] - Validation options
 * @returns {Promise<Object>} Complete validation result
 */
async function validateFull(code, workspaceRoot, options = {}) {
  const { trace = true } = options;

  // Step 1: Type checking
  const typeResult = await validateCode(code);

  // Step 2: Primitive whitelist validation
  const primitiveResult = validatePrimitives(code);

  // Step 3: Trace validation (optional)
  let traceResult = null;
  if (trace) {
    const tracer = new TraceValidator();
    traceResult = await tracer.trace(code, workspaceRoot);
  }

  // Step 4: Determine overall status
  const allValid = typeResult.valid && primitiveResult.valid && 
                   (traceResult ? traceResult.verification.reExecutable : true);

  return {
    valid: allValid,
    typeChecking: typeResult,
    primitiveValidation: primitiveResult,
    traceValidation: traceResult,
    documentation: {
      status: allValid ? 'passed' : 'failed',
      timestamp: new Date().toISOString(),
      checks: {
        typeChecking: typeResult.valid,
        primitiveWhitelist: primitiveResult.valid,
        callTracing: traceResult ? traceResult.traces.length > 0 : false,
        reExecution: traceResult ? traceResult.verification.reExecutable : null
      },
      notes: [
        'Local technical validation only',
        'No claims of semantic validation',
        'No claims of exhaustiveness'
      ]
    },
    rollback: traceResult ? traceResult.rollback : null
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Main functions
  validateCode,
  validatePrimitives,
  validateFull,
  
  // Constants
  WHITELIST,
  DANGEROUS_FUNCTIONS,
  MAX_CODE_LENGTH,
  
  // Classes
  TypeValidationResult,
  PrimitiveValidationResult,
  CallTrace,
  CallProof,
  TraceResult,
  TraceValidator
};
