import * as fs from 'node:fs';
import * as path from 'node:path';

const sensitiveKey = /api[_-]?key|authorization|cookie|password|secret|credential|access[_-]?token|refresh[_-]?token|^environment$|^env$|^headers$/i;

export function sanitizeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKey.test(key)).map(([key, item]) => [key, sanitizeEvidence(item)]));
  }
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return JSON.stringify(sanitizeEvidence(parsed));
  } catch {}
  let text = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (sensitiveKey.test(key) && secret && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
}

export function sanitizeArtifacts(directory: string): void {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { fs.unlinkSync(file); continue; }
    if (stat.isDirectory()) { fs.chmodSync(file, 0o700); sanitizeArtifacts(file); continue; }
    if (!stat.isFile()) continue;
    const text = fs.readFileSync(file, 'utf8');
    let sanitized: string;
    if (name.includes('.jsonl')) {
      sanitized = text.split('\n').map(line => {
        try { return JSON.stringify(sanitizeEvidence(JSON.parse(line))); }
        catch { return String(sanitizeEvidence(line)); }
      }).join('\n');
    } else {
      try { sanitized = JSON.stringify(sanitizeEvidence(JSON.parse(text)), null, 2); }
      catch { sanitized = String(sanitizeEvidence(text)); }
    }
    fs.writeFileSync(file, sanitized, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
}
