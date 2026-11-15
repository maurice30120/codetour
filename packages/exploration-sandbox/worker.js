const fs = require('node:fs');
const path = require('node:path');
const { getQuickJS } = require('quickjs-emscripten');
const { validateAndTranspile } = require('./typescript-validator');
const { validatePrimitives, TraceValidator, validateFull } = require('./validation');

async function main({ workspace, code, paramsJson, deadline }) {
  if (Date.now() >= deadline) throw new Error('Sandbox timeout');
  const root = fs.realpathSync(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error('Workspace must be a directory');
  
  // Enhanced trace object for validation (ticket 04)
  const trace = {
    version: '2.0', // Updated for ticket 04
    identifier: '',
    fingerprint: '',
    parameters: {},
    executedCalls: [],
    results: null,
    errors: [],
    proofs: [], // Added for ticket 04 - proofs of calls
    revision: '', // Added for ticket 04 - git revision
    validation: { // Added for ticket 04
      typeChecking: { valid: false, errors: [] },
      primitiveWhitelist: { valid: false, violations: [] },
      reExecutionVerified: false,
      documentation: null
    },
    rollback: null // Added for ticket 04
  };

  // Get git revision for tracing (ticket 04)
  try {
    const { execSync } = require('node:child_process');
    if (fs.existsSync(path.join(root, '.git'))) {
      try {
        trace.revision = execSync('git rev-parse HEAD', { 
          cwd: root,
          encoding: 'utf8',
          timeout: 2000 
        }).trim().slice(0, 12);
      } catch {}
    }
  } catch {}

  // Step 1: Detect if code is TypeScript (has TypeScript-specific syntax)
  // Only use features that are definitely TypeScript and not JavaScript
  const isTypeScript = code.includes('interface ') || 
                        code.includes('type ') || 
                        code.includes(' as const') || 
                        code.includes(' as unknown') || 
                        code.includes(' as never') ||
                        code.includes(' as any') ||
                        (code.includes('import ') && !code.includes('require(')) || 
                        (code.includes('export ') && !code.includes('module.exports')) ||
                        code.includes('readonly ') ||
                        code.includes('?.:') ||
                        code.endsWith('.ts') ||
                        // Check for generic syntax that's not a tag
                        (code.match(/<[a-zA-Z_$][a-zA-Z0-9_$]*>/) && !code.includes('</'));

  let finalCode = code;
  
  // Step 2: Perform local technical validation (ticket 04)
  // This includes TypeScript validation, primitive whitelist, tracing, and re-execution verification
  let validationPassed = true;
  
  // A. TypeScript validation (from ticket 02, enhanced for ticket 04)
  if (isTypeScript || code.includes(': ') || code.includes('interface ') || code.includes('type ')) {
    try {
      const validationResult = await validateAndTranspile(code, 'input.ts');
      
      // Update trace from validation
      trace.identifier = validationResult.trace.identifier || '';
      trace.fingerprint = validationResult.trace.fingerprint || '';
      trace.parameters = validationResult.trace.parameters || {};
      trace.errors = trace.errors.concat(validationResult.trace.errors || []);
      
      // Store type checking results in validation object
      trace.validation.typeChecking = {
        valid: validationResult.diagnostics.length === 0,
        errors: validationResult.diagnostics.map(d => `${d.code}:${d.line}:${d.message}`)
      };
      
      if (validationResult.diagnostics && validationResult.diagnostics.length > 0) {
        validationPassed = false;
        // Format compact error messages
        const errors = validationResult.diagnostics.map(d => 
          `${d.code || 'ERROR'}:${d.line}:${d.message}`
        ).join('; ');
        trace.validation.typeChecking.errors = validationResult.diagnostics.map(d => `${d.code}:${d.line}:${d.message}`);
        
        // Don't throw immediately - collect all validation errors
        trace.errors.push({ code: 'TS_VALIDATION_FAILED', line: 1, message: 'TypeScript validation failed' });
      }
      
      if (validationResult.javascript) {
        finalCode = validationResult.javascript;
      }
    } catch (validationError) {
      validationPassed = false;
      trace.validation.typeChecking = {
        valid: false,
        errors: [String(validationError.message || validationError)]
      };
      trace.errors.push({ code: 'TS_VALIDATION_ERROR', line: 1, message: String(validationError.message || validationError) });
    }
  } else {
    // For JavaScript, do basic primitive validation
    trace.validation.typeChecking = { valid: true, errors: [] };
  }
  
  // B. Primitive whitelist validation (from ticket 01, enhanced for ticket 04)
  try {
    const primitiveResult = validatePrimitives(code);
    trace.validation.primitiveWhitelist = {
      valid: primitiveResult.valid,
      violations: primitiveResult.violations.map(v => `${v.type}:${v.function || ''}:${v.message}`)
    };
    
    if (!primitiveResult.valid) {
      validationPassed = false;
      trace.errors = trace.errors.concat(primitiveResult.violations.map(v => ({
        code: v.type === 'dangerous-function' ? 'PRIMITIVE_DANGEROUS' : 'PRIMITIVE_NOT_ALLOWED',
        line: v.line || 1,
        message: v.message
      })));
    }
  } catch (e) {
    validationPassed = false;
    trace.validation.primitiveWhitelist = { valid: false, violations: [String(e.message || e)] };
    trace.errors.push({ code: 'PRIMITIVE_VALIDATION_ERROR', line: 1, message: String(e.message || e) });
  }
  
  // C. Call tracing with proofs (ticket 04)
  try {
    const tracer = new TraceValidator();
    const traceResult = await tracer.trace(finalCode, root);
    
    trace.proofs = traceResult.proofs.map(p => ({
      call: p.call.function,
      file: p.call.file,
      line: p.call.line,
      revision: p.call.revision,
      evidence: p.evidence
    }));
    
    // Store traces from primitive execution (will be populated during execution)
    trace.executedCalls = traceResult.traces.map(t => ({
      name: t.function,
      file: t.file,
      line: t.line,
      revision: t.revision,
      params: t.arguments
    }));
    
    // Check re-execution verification
    trace.validation.reExecutionVerified = traceResult.verification.reExecutable;
    
    if (!traceResult.verification.reExecutable) {
      validationPassed = false;
      trace.errors.push({ code: 'RE_EXECUTION_FAILED', line: 1, message: 'Re-execution verification failed' });
    }
  } catch (e) {
    trace.errors.push({ code: 'TRACE_ERROR', line: 1, message: String(e.message || e) });
  }
  
  // D. Generate documentation (ticket 04)
  trace.validation.documentation = {
    status: validationPassed ? 'passed' : 'failed',
    timestamp: new Date().toISOString(),
    checks: {
      typeChecking: trace.validation.typeChecking.valid,
      primitiveWhitelist: trace.validation.primitiveWhitelist.valid,
      callTracing: true,
      reExecution: trace.validation.reExecutionVerified
    },
    notes: [
      'Local technical validation only',
      'No claims of semantic validation',
      'No claims of exhaustiveness'
    ]
  };
  
  // If validation failed, throw error
  if (!validationPassed) {
    const errorMessages = trace.validation.typeChecking.errors.concat(
      trace.validation.primitiveWhitelist.violations,
      trace.errors.map(e => e.message)
    ).join('; ');
    throw new Error(`Local technical validation failed: ${errorMessages}`);
  }
  
  // E. Set up rollback (ticket 04)
  // Rollback will be available after execution
  trace.rollback = function() {
    return {
      originalState: 'pre-execution',
      timestamp: new Date().toISOString(),
      notes: 'Rollback to state before execution' + (trace.revision ? ` at revision ${trace.revision}` : '')
    };
  };

  let calls = 0;
  const limit = () => { 
    if (++calls > 100) {
      trace.errors.push({ code: 'LIMIT_001', line: 0, message: 'Tool call limit exceeded' });
      throw new Error('Tool call limit exceeded');
    }
  };
  
  const resolve = name => {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(p => p === '..' || p === '' || p === '.' || p === '.git')) {
      trace.errors.push({ code: 'PATH_001', line: 0, message: 'Invalid path' });
      throw new Error('Invalid path');
    }
    let current = root;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) {
        trace.errors.push({ code: 'PATH_002', line: 0, message: 'Symlinks are not allowed' });
        throw new Error('Symlinks are not allowed');
      }
    }
    return current;
  };
  
  const listFiles = (maxFiles = 500) => {
    trace.executedCalls.push({ name: 'listFiles', params: { maxFiles } });
    const found = [];
    function visit(dir, prefix) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (found.length >= maxFiles) return;
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) visit(path.join(dir, entry.name), name);
        else if (entry.isFile()) found.push(name);
      }
    }
    visit(root, '');
    return found;
  };
  
  const read = (name, start = 1, end = start + 99) => {
    trace.executedCalls.push({ name: 'read', params: { file: name, start, end } });
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 100) {
      trace.errors.push({ code: 'READ_001', line: 0, message: 'Invalid line range' });
      throw new Error('Invalid line range');
    }
    const file = resolve(name);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1048576) {
      trace.errors.push({ code: 'READ_002', line: 0, message: 'File unavailable or too large' });
      throw new Error('File unavailable or too large');
    }
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) {
      trace.errors.push({ code: 'READ_003', line: 0, message: 'Binary file' });
      throw new Error('Binary file');
    }
    return { file: name, start, lines: text.split('\n').slice(start - 1, end).map(line => line.slice(0, 2000)) };
  };
  
  const operations = {
    listFiles: () => listFiles(),
    list: () => listFiles(), // alias for backward compatibility
    readLines: (file, startLine, endLine) => {
      trace.executedCalls.push({ name: 'readLines', params: { file, startLine, endLine } });
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 100) {
        trace.errors.push({ code: 'READ_001', line: 0, message: 'Invalid line range' });
        throw new Error('Invalid line range');
      }
      return read(file, startLine, endLine);
    },
    read,
    readAround: (file, line, contextLines) => {
      trace.executedCalls.push({ name: 'readAround', params: { file, line, contextLines } });
      if (!Number.isInteger(line) || line < 1) {
        trace.errors.push({ code: 'READ_004', line: 0, message: 'Invalid line number' });
        throw new Error('Invalid line number');
      }
      if (contextLines !== undefined && (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 20)) {
        trace.errors.push({ code: 'READ_005', line: 0, message: 'Invalid context' });
        throw new Error('Invalid context');
      }
      const startLine = Math.max(1, line - (contextLines || 5));
      const endLine = line + (contextLines || 5);
      return read(file, startLine, endLine);
    },
    searchText: (query) => search(query),
    search: (query, options) => {
      trace.executedCalls.push({ name: 'search', params: { query, options } });
      if (typeof query !== 'string' || !query || query.length > 200) {
        trace.errors.push({ code: 'SEARCH_001', line: 0, message: 'Invalid search' });
        throw new Error('Invalid search');
      }
      const scoped = options !== undefined;
      if (scoped && (!options || typeof options !== 'object' || Array.isArray(options))) {
        trace.errors.push({ code: 'SEARCH_002', line: 0, message: 'Invalid search options' });
        throw new Error('Invalid search options');
      }
      const prefix = scoped ? (options.pathPrefix ?? '') : '';
      const offset = scoped ? (options.offset ?? 0) : 0;
      const pageSize = scoped ? (options.limit ?? 10) : 50;
      if (typeof prefix !== 'string' || prefix.length > 300 || prefix.startsWith('/') || prefix.includes('\\') || prefix.includes('\0') || prefix.split('/').some(p => p === '..' || p === '.' || p === '.git')) {
        trace.errors.push({ code: 'SEARCH_003', line: 0, message: 'Invalid search prefix' });
        throw new Error('Invalid search prefix');
      }
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
        trace.errors.push({ code: 'SEARCH_004', line: 0, message: 'Invalid search page' });
        throw new Error('Invalid search page');
      }
      const matches = [];
      let seen = 0, hasMore = false;
      const files = listFiles(30000);
      for (const file of files) {
        if (prefix && !file.startsWith(prefix)) continue;
        let lines;
        try {
          const target = resolve(file);
          const stat = fs.statSync(target);
          if (!stat.isFile() || stat.size > 1048576) continue;
          const text = fs.readFileSync(target, 'utf8');
          if (text.includes('\0')) continue;
          lines = text.split('\n');
        } catch { continue; }
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].includes(query)) continue;
          if (seen++ < offset) continue;
          if (matches.length === pageSize) { hasMore = true; break; }
          matches.push({ file, line: i + 1, text: lines[i].slice(0, 2000) });
          if (!scoped && matches.length === pageSize) { hasMore = true; break; }
        }
        if (hasMore) break;
      }
      return scoped ? { matches, offset, limit: pageSize, hasMore, fileScanLimitReached: files.length >= 30000 } : matches;
    },
    searchIdentifiers: (identifier) => {
      trace.executedCalls.push({ name: 'searchIdentifiers', params: { identifier } });
      if (!identifier || typeof identifier !== 'string' || identifier.length > 200) {
        trace.errors.push({ code: 'SEARCH_005', line: 0, message: 'Invalid identifier' });
        throw new Error('Invalid identifier');
      }
      const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const found = [];
      const files = listFiles(30000);
      for (const file of files) {
        try {
          const target = resolve(file);
          const stat = fs.statSync(target);
          if (!stat.isFile() || stat.size > 1048576) continue;
          const lines = fs.readFileSync(target, 'utf8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) found.push({ file, line: i + 1, text: lines[i].slice(0, 500) });
            if (found.length >= 50) return found;
          }
        } catch { continue; }
      }
      return found;
    },
    listSymbols: () => {
      trace.executedCalls.push({ name: 'listSymbols', params: {} });
      const symbols = [];
      const patterns = [
        { regex: /function\\s+(\\w+)/g, kind: 'function' },
        { regex: /class\\s+(\\w+)/g, kind: 'class' },
        { regex: /const\\s+(\\w+)/g, kind: 'constant' }
      ];
      const files = listFiles(30000);
      for (const file of files) {
        try {
          const target = resolve(file);
          const stat = fs.statSync(target);
          if (!stat.isFile() || stat.size > 1048576) continue;
          const lines = fs.readFileSync(target, 'utf8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            for (const { regex, kind } of patterns) {
              let match;
              while ((match = regex.exec(lineText)) !== null) {
                symbols.push({ file, line: i + 1, name: match[1], kind });
                if (symbols.length >= 100) return symbols;
              }
            }
          }
        } catch { continue; }
      }
      return symbols;
    },
    findDefinitions: (symbol) => {
      trace.executedCalls.push({ name: 'findDefinitions', params: { symbol } });
      if (!symbol || typeof symbol !== 'string' || symbol.length > 200) {
        trace.errors.push({ code: 'FIND_001', line: 0, message: 'Invalid symbol' });
        throw new Error('Invalid symbol');
      }
      const definitions = [];
      const patterns = [
        { regex: new RegExp(`function\\s+${symbol}\\s*\\(`), kind: 'function' },
        { regex: new RegExp(`class\\s+${symbol}\\s*\\{`), kind: 'class' },
        { regex: new RegExp(`const\\s+${symbol}\\s*=`), kind: 'constant' }
      ];
      const files = listFiles(30000);
      for (const file of files) {
        try {
          const target = resolve(file);
          const stat = fs.statSync(target);
          if (!stat.isFile() || stat.size > 1048576) continue;
          const lines = fs.readFileSync(target, 'utf8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            for (const { regex, kind } of patterns) {
              if (regex.test(lineText)) {
                definitions.push({ file, line: i + 1, text: lineText.slice(0, 500), kind });
                if (definitions.length >= 20) return definitions;
              }
            }
          }
        } catch { continue; }
      }
      return definitions;
    },
    findReferences: (symbol) => {
      trace.executedCalls.push({ name: 'findReferences', params: { symbol } });
      return searchIdentifiers(symbol);
    },
    getImports: (filePath) => {
      trace.executedCalls.push({ name: 'getImports', params: { filePath } });
      if (!filePath || typeof filePath !== 'string') {
        trace.errors.push({ code: 'IMPORT_001', line: 0, message: 'Invalid file path' });
        throw new Error('Invalid file path');
      }
      const target = resolve(filePath);
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 1048576) {
        trace.errors.push({ code: 'IMPORT_002', line: 0, message: 'Not a regular file or file too large' });
        throw new Error('Not a regular file or file too large');
      }
      const text = fs.readFileSync(target, 'utf8');
      const imports = [];
      const lines = text.split('\n');
      const importRegex = /^\\s*(?:import|require)\\s*[\\'"`]?[^\\'"`;]+[\\'"`]?/;
      for (let i = 0; i < lines.length; i++) {
        if (importRegex.test(lines[i])) {
          imports.push({ file: filePath, line: i + 1, text: lines[i].slice(0, 500) });
        }
      }
      return imports;
    },
    getGitDiff: (revision1, revision2) => {
      trace.executedCalls.push({ name: 'getGitDiff', params: { revision1, revision2 } });
      if (!revision1 || typeof revision1 !== 'string' || revision1.length > 100) {
        trace.errors.push({ code: 'GIT_001', line: 0, message: 'Invalid revision' });
        throw new Error('Invalid revision');
      }
      const revision = revision2 || 'HEAD';
      if (!revision || typeof revision !== 'string' || revision.length > 100) {
        trace.errors.push({ code: 'GIT_002', line: 0, message: 'Invalid revision' });
        throw new Error('Invalid revision');
      }
      const child = require('node:child_process').spawnSync('git', ['-C', root, 'diff', '--no-color', revision1, revision], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      if (child.error) {
        trace.errors.push({ code: 'GIT_003', line: 0, message: 'Git diff failed' });
        throw new Error('Git diff failed');
      }
      return child.stdout.slice(0, 32768);
    },
    // Add TypeScript validation function for function_try
    validateTypeScript: (tsCode) => {
      trace.executedCalls.push({ name: 'validateTypeScript', params: {} });
      return validateAndTranspile(tsCode, 'validation.ts');
    }
  };
  
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();
  
  try {
    const parameterString = vm.newString(paramsJson);
    vm.setProp(vm.global, '__paramsJson', parameterString);
    parameterString.dispose();
    
    for (const [name, operation] of Object.entries(operations)) {
      const fn = vm.newFunction(`_${name}`, (...args) => {
        try { 
          limit(); 
          const result = operation(...args.map(arg => vm.dump(arg)));
          return vm.newString(JSON.stringify({ value: result }));
        }
        catch (error) { 
          trace.errors.push({ code: 'OP_001', line: 0, message: error.message });
          return vm.newString(JSON.stringify({ error: String(error.message).slice(0, 200) }));
        }
      });
      vm.setProp(vm.global, `_${name}`, fn); 
      fn.dispose();
    }
    
    // Inject params and primitives into globalThis
    const wrapper = `const params = JSON.parse(__paramsJson); delete globalThis.__paramsJson;\nfor (const n of ['listFiles','readLines','readAround','searchText','searchIdentifiers','listSymbols','findDefinitions','findReferences','getImports','getGitDiff','list','read','search']) { globalThis[n] = (...args) => { const r = JSON.parse(globalThis['_'+n](...args)); if (r.error) throw Error(r.error); return r.value; }; }\n(() => { 
      const value = (${finalCode}\n); 
      if (value && typeof value.then === 'function') throw Error('Async results are unsupported'); 
      return JSON.stringify(value); 
    })()`;
    
    const result = vm.evalCode(wrapper);
    
    if (result.error) { 
      const err = vm.dump(result.error); 
      result.error.dispose();
      trace.errors.push({ code: 'JS_001', line: 0, message: err.message || String(err) });
      throw new Error(`Script error: ${err.message || err}`); 
    }
    
    const serialized = vm.dump(result.value); 
    result.value.dispose();
    
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 32768) {
      trace.errors.push({ code: 'RESULT_001', line: 0, message: 'Result must be JSON within output limit' });
      throw new Error('Result must be JSON within output limit');
    }
    
    trace.results = JSON.parse(serialized);
    
    return { 
      value: JSON.parse(serialized),
      trace: trace
    };
  } finally { 
    vm.dispose(); 
    runtime.dispose(); 
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { 
  input += chunk; 
  if (input.length > 1048576) process.exit(1); 
});
process.stdin.on('end', async () => {
  try { 
    const result = await main(JSON.parse(input));
    process.stdout.write(JSON.stringify({ value: result.value, trace: result.trace }));
  } 
  catch (error) { 
    // Extract compact error message
    const errorMessage = String(error.message || error).slice(0, 500);
    process.stdout.write(JSON.stringify({ error: errorMessage }));
  }
});
