const { spawn } = require('node:child_process');
const path = require('node:path');

function runScript({ workspace, code, params = {}, timeoutMs = 3000, signal, scripts, strict = false, includeTrace = false }) {
  if (typeof workspace !== 'string' || typeof code !== 'string' || code.length > 32768 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
    return Promise.reject(new Error('Invalid sandbox input'));
  }
  // Issue #174 complement: procedures call ONLY the ten permanent primitives.
  // Composition across procedure outputs belongs to the agent's Tour logic,
  // never inside memorized code. Reject any memorized function calling another
  // memorized function (or the memory tools) with an explicit error.
  let memorizedNames = [];
  if (scripts !== undefined) {
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      return Promise.reject(new Error('Invalid sandbox input: scripts must be an object of name -> source'));
    }
    memorizedNames = Object.keys(scripts);
    for (const name of memorizedNames) {
      if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(code)) {
        return Promise.reject(new Error(`NESTING_REJECTED: memorized procedure "${name}" cannot be called from inside another memorized procedure; compose in the Tour logic instead`));
      }
    }
    if (/\b(memory_list|memory_run|function_try|memory_unusable)\b/.test(code)) {
      return Promise.reject(new Error('NESTING_REJECTED: memory tools cannot be called from inside a memorized procedure; only the ten permanent primitives are callable'));
    }
  }
  let paramsJson;
  try { paramsJson = JSON.stringify(params); }
  catch { return Promise.reject(new Error('Invalid JSON parameters')); }
  if (typeof paramsJson !== 'string' || Buffer.byteLength(paramsJson) > 8192) return Promise.reject(new Error('Invalid JSON parameters')); 
  if (signal?.aborted) return Promise.reject(new Error('Sandbox aborted'));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const child = spawn(process.execPath, [`--max-old-space-size=${strict ? 192 : 64}`, path.join(__dirname, 'worker.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '' } });
    let output = '', error = '', finished = false;
    const finish = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (err) reject(err); else resolve(value);
    };
    const abort = () => { child.kill('SIGKILL'); finish(new Error('Sandbox aborted')); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Sandbox timeout')); }, Math.max(0, deadline - Date.now()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.on('error', e => finish(e));
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 131072) { child.kill('SIGKILL'); finish(new Error('Sandbox output limit exceeded')); }
    });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(0, 1000); });
    child.on('close', status => {
      if (status !== 0) return finish(new Error(`Sandbox failed: ${error || status}`));
      try {
        const result = JSON.parse(output);
        const failure = result.error ? Object.assign(new Error(result.error), { trace: result.trace }) : null;
        finish(failure, includeTrace ? { value: result.value, trace: result.trace } : result.value);
      } catch { finish(new Error('Invalid sandbox output')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ workspace, code, paramsJson, deadline, memorizedNames, strict }));
  });
}
module.exports = { runScript };
