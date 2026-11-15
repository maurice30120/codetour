import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ExecutionManager, AgentExecutor, Question } from '../src/execution/manager';
import { ImmutableLogger } from '../src/storage/logger';

export function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
  const root = path.join(dir, 'fixture'); fs.mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); fs.writeFileSync(path.join(root, 'code.c'), 'void entry(void) {}\n');
  git('add', '.'); git('-c', 'user.name=Runner Test', '-c', 'user.email=runner@test.invalid', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const logger = new ImmutableLogger({ outputDir: path.join(dir, 'out'), testOnly: { expectedFixtureSha: sha } } as ConstructorParameters<typeof ImmutableLogger>[0]);
  const manager = new ExecutionManager(logger, { fixturePath: root, retryPolicy: { maxRetries: 1, retryDelay: 0 } });
  const question: Question = { id: 'R-1', objective: 'Explain entry', series: 'R', phase: 'repetition', repeat_index: 0, postgres_sha: sha };
  return { dir, root, sha, logger, manager, question };
}

export function executor(execute: AgentExecutor['execute'], name: AgentExecutor['name'] = 'codetour'): AgentExecutor {
  return { name, version: 'test-boundary', model: 'offline-test', modelParams: { temperature: 0, max_tokens: 64 }, execute };
}

