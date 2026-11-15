const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');

const primitiveNames = ['listFiles', 'searchText', 'searchIdentifiers', 'readLines', 'readAround', 'listSymbols', 'findDefinitions', 'findReferences', 'getImports', 'getGitDiff'];

function parameterType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array<${[...new Set(value.map(parameterType))].join(' | ') || 'unknown'}>`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${parameterType(item)}`).join(';')}}`;
  return typeof value;
}

function validateStrict(code, params) {
  const file = path.join(__dirname, '__candidate.ts');
  const declarations = fs.readFileSync(path.join(__dirname, 'strict-primitives.d.ts'), 'utf8');
  const prefix = `${declarations}\ndeclare const params: ${parameterType(params)};\n`;
  const source = prefix + code;
  const options = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...args) => name === file ? ts.createSourceFile(name, source, version, true) : original(name, version, ...args);
  const program = ts.createProgram([file], options, host);
  const prefixLines = prefix.split('\n').length - 1;
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => !d.file || d.file.fileName === file);
  if (diagnostics.length) {
    const d = diagnostics[0];
    const line = d.file ? Math.max(1, d.file.getLineAndCharacterOfPosition(d.start).line + 1 - prefixLines) : 1;
    throw new Error(`TS${d.code}:${line}:${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 240)}`);
  }
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ES2022, true);
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      throw new Error('WHITELIST:1:Modules are not allowed');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const checker = program.getTypeChecker();
  const checked = program.getSourceFile(file);
  const last = checked.statements.at(-1);
  const paramsDeclaration = checked.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(checked) === 'params'));
  const actualParams = checker.getTypeAtLocation(paramsDeclaration.declarationList.declarations[0].name);
  const output = ts.isExpressionStatement(last) ? checker.getTypeAtLocation(last.expression) : undefined;
  const signature = output?.getCallSignatures()[0];
  const input = signature?.parameters[0] ? checker.getTypeOfSymbolAtLocation(signature.parameters[0], last) : actualParams;
  if (signature?.parameters[0] && !checker.isTypeAssignableTo(actualParams, input)) throw new Error('TS2345:1:Trial params do not match the function parameter type');
  const paramsSchema = checker.getPropertiesOfType(input).map(symbol => ({ name: symbol.name, type: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, last)).slice(0, 200) }));
  const returns = output ? checker.typeToString(signature ? checker.getReturnTypeOfSignature(signature) : output).slice(0, 300) : 'unknown';
  return { javascript: ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, strict: true } }).outputText, paramsSchema, returns };
}

module.exports = { validateStrict, primitiveNames };
