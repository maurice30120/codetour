const fs = require('node:fs');
const path = require('node:path');
const { getQuickJS } = require('quickjs-emscripten');

async function main({ workspace, code, paramsJson, scripts = {}, deadline }) {
  if (Date.now() >= deadline) throw new Error('Sandbox timeout');
  const root = fs.realpathSync(workspace);
  if (!fs.statSync(root).isDirectory()) throw new Error('Workspace must be a directory');
  let calls = 0;
  const limit = () => { if (++calls > 100) throw new Error('Tool call limit exceeded'); };
  const resolve = name => {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.includes('\\') || name.split('/').some(p => p === '..' || p === '' || p === '.' || p === '.git')) throw new Error('Invalid path');
    let current = root;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlinks are not allowed');
    }
    return current;
  };
  const listFiles = (maxFiles = 500) => {
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
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 100) throw new Error('Invalid line range');
    const file = resolve(name);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1048576) throw new Error('File unavailable or too large');
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('\0')) throw new Error('Binary file');
    return { file: name, start, lines: text.split('\n').slice(start - 1, end).map(line => line.slice(0, 2000)) };
  };
  const operations = {
    list: () => listFiles(),
    read,
    search: (query, options) => {
      if (typeof query !== 'string' || !query || query.length > 200) throw new Error('Invalid search');
      const scoped = options !== undefined;
      if (scoped && (!options || typeof options !== 'object' || Array.isArray(options))) throw new Error('Invalid search options');
      const prefix = scoped ? (options.pathPrefix ?? '') : '';
      const offset = scoped ? (options.offset ?? 0) : 0;
      const pageSize = scoped ? (options.limit ?? 10) : 50;
      if (typeof prefix !== 'string' || prefix.length > 300 || prefix.startsWith('/') || prefix.includes('\\') || prefix.includes('\0') || prefix.split('/').some(p => p === '..' || p === '.' || p === '.git')) throw new Error('Invalid search prefix');
      if (!Number.isInteger(offset) || offset < 0 || offset > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('Invalid search page');
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
    const scriptsString = vm.newString(JSON.stringify(scripts));
    vm.setProp(vm.global, '__scriptsJson', scriptsString);
    scriptsString.dispose();
    for (const [name, operation] of Object.entries(operations)) {
      const fn = vm.newFunction(`_${name}`, (...args) => {
        try { limit(); return vm.newString(JSON.stringify({ value: operation(...args.map(arg => vm.dump(arg))) })); }
        catch (error) { return vm.newString(JSON.stringify({ error: String(error.message).slice(0, 200) })); }
      });
      vm.setProp(vm.global, `_${name}`, fn); fn.dispose();
    }
    const wrapper = `const params = JSON.parse(__paramsJson); delete globalThis.__paramsJson;\nconst sources = JSON.parse(__scriptsJson); delete globalThis.__scriptsJson;\nfor (const n of ['list','read','search']) { globalThis[n] = (...args) => { const r = JSON.parse(globalThis['_'+n](...args)); if (r.error) throw Error(r.error); return r.value; }; }\nlet depth = 0; globalThis.script = (id, args) => { if (!Object.prototype.hasOwnProperty.call(sources,id)) throw Error('Unknown script'); if (++depth > 20) throw Error('Script nesting limit'); try { return Function('params', 'return (' + sources[id] + '\\n)')(args); } finally { depth--; } };\n(() => { const value = (${code}\n); if (value && typeof value.then === 'function') throw Error('Async results are unsupported'); return JSON.stringify(value); })()`;
    const result = vm.evalCode(wrapper);
    if (result.error) { const err = vm.dump(result.error); result.error.dispose(); throw new Error(`Script error: ${err.message || err}`); }
    const serialized = vm.dump(result.value); result.value.dispose();
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 32768) throw new Error('Result must be JSON within output limit');
    return JSON.parse(serialized);
  } finally { vm.dispose(); runtime.dispose(); }
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 1048576) process.exit(1); });
process.stdin.on('end', async () => {
  try { process.stdout.write(JSON.stringify({ value: await main(JSON.parse(input)) })); }
  catch (error) { process.stdout.write(JSON.stringify({ error: String(error.message).slice(0, 500) })); }
});
