import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { createStream } from 'rotating-file-stream';

// Share one rotating file per project within a process; no per-run log files.
const loggers = new Map<string, pino.Logger>();
const sensitiveKeys = ['apiKey', 'token', 'authorization'];
const redact = sensitiveKeys.flatMap(key => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`, `*.*.*.*.${key}`, `*.*.*.*.*.${key}`]);

export function researchLog(root: string, runId: string): pino.Logger {
  const base = realpathSync(root);
  for (const directory of [join(base, '.tours'), join(base, '.tours', '.log')]) {
    try { mkdirSync(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Log directory must be a real directory inside the workspace: ${directory}`);
  }
  let logger = loggers.get(base);
  if (!logger) {
    const stream = createStream('research.log', { path: join(base, '.tours', '.log'), size: '10M', maxFiles: 10 });
    logger = pino({ redact: { paths: redact, censor: '[Redacted]' } }, stream);
    loggers.set(base, logger);
  }
  return logger.child({ runId });
}
