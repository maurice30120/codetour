const { spawn } = require('node:child_process');
const path = require('node:path');

function runScript({ workspace, code, params = {}, scripts = {}, timeoutMs = 3000, signal }) {
  if (typeof workspace !== 'string' || typeof code !== 'string' || code.length > 32768 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
    return Promise.reject(new Error('Invalid sandbox input'));
  }
  let paramsJson;
  try { paramsJson = JSON.stringify(params); }
  catch { return Promise.reject(new Error('Invalid JSON parameters')); }
  if (typeof paramsJson !== 'string' || Buffer.byteLength(paramsJson) > 8192) return Promise.reject(new Error('Invalid JSON parameters')); 
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts) || Object.keys(scripts).length > 20 || Object.entries(scripts).some(([id, source]) => !/^[a-f0-9]{16}$/.test(id) || typeof source !== 'string' || source.length > 32768) || Buffer.byteLength(JSON.stringify(scripts)) > 655360) return Promise.reject(new Error('Invalid scripts'));
  if (signal?.aborted) return Promise.reject(new Error('Sandbox aborted'));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const child = spawn(process.execPath, ['--max-old-space-size=64', path.join(__dirname, 'worker.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH || '' } });
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
      if (Buffer.byteLength(output) > 65536) { child.kill('SIGKILL'); finish(new Error('Sandbox output limit exceeded')); }
    });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(0, 1000); });
    child.on('close', status => {
      if (status !== 0) return finish(new Error(`Sandbox failed: ${error || status}`));
      try {
        const result = JSON.parse(output);
        finish(result.error ? new Error(result.error) : null, result.value);
      } catch { finish(new Error('Invalid sandbox output')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ workspace, code, paramsJson, scripts, deadline }));
  });
}
module.exports = { runScript };
