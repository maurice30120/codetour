/**
 * Historical Memory Functions and Methods retain their TypeScript identifier
 * rule. Knowledge entries use a separate safe, flat-file name rule below.
 */
const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch', 'this',
  'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'enum',
  'await', 'implements', 'interface', 'package', 'private', 'protected', 'public',
  'static'
]);

/** Accept any usable TypeScript identifier; its meaning belongs in the documentation. */
export function validateCanonicalName(name: string): { ok: boolean; reason?: string } {
  if (!/^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u.test(name) || RESERVED.has(name)) {
    return { ok: false, reason: 'Name must be a valid TypeScript identifier' };
  }
  return { ok: true };
}

/** Knowledge names are flat lookup keys; they are never executed as code. */
export function validateKnowledgeName(name: string): { ok: boolean; reason?: string } {
  if (!/^[$_\p{ID_Start}\p{N}][$_\u200c\u200d\p{ID_Continue}-]*$/u.test(name)) {
    return { ok: false, reason: 'Name must be a safe flat Knowledge name' };
  }
  return { ok: true };
}

/** Existing names remain readable; new names must also work on Windows. */
export function validateNewKnowledgeName(name: string): { ok: boolean; reason?: string } {
  const valid = validateKnowledgeName(name);
  if (!valid.ok) return valid;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    return { ok: false, reason: 'Name is reserved by Windows' };
  }
  return valid;
}
