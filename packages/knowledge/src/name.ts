/**
 * The canonical-name rule shared by Memory Methods (ADR 0036) and Knowledge
 * entries (ADR 0039): one usable TypeScript identifier, so an entry name is
 * also a safe flat file name and a safe lookup key.
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
