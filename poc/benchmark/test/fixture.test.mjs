import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadAgentQuestions, validateBundle, verifyCheckout } from '../fixture.mjs';

const bundleDirectory = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = process.env.POSTGRES_FIXTURE || join(bundleDirectory, 'postgres');

function changedBundle(t, edit) {
  const directory = mkdtempSync(join(tmpdir(), 't04-bundle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ['postgres-questions.json', 'postgres-expected-answers.json', 'manifest.json']) {
    cpSync(join(bundleDirectory, name), join(directory, name));
  }
  const file = join(directory, 'postgres-questions.json');
  const questions = JSON.parse(readFileSync(file, 'utf8'));
  edit(questions);
  writeFileSync(file, JSON.stringify(questions));
  return directory;
}

function changedReferences(t, edit) {
  const directory = changedBundle(t, () => {});
  const file = join(directory, 'postgres-expected-answers.json');
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  edit(expected);
  writeFileSync(file, JSON.stringify(expected));
  const manifestFile = join(directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.questions_hash = `sha256:${createHash('sha256').update(readFileSync(join(directory, 'postgres-questions.json'))).digest('hex')}`;
  manifest.expected_answers_hash = `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
  writeFileSync(manifestFile, JSON.stringify(manifest));
  return directory;
}

test('agents receive 20 repetition and 20 transfer objectives without reference answers', () => {
  const questions = loadAgentQuestions(bundleDirectory);
  assert.equal(questions.series_R.length, 20);
  assert.equal(questions.series_T.length, 20);
  assert.equal(questions.series_T.filter(q => q.is_priming).length, 10);
  for (const q of [...questions.series_R, ...questions.series_T]) {
    assert.deepEqual(Object.keys(q).sort(), [
      'id', 'objective', 'phase', 'postgres_sha', 'repeat_index', 'series',
      ...(q.series === 'T' ? ['is_priming'] : []),
    ].sort());
    assert.ok(q.objective.length > 30);
  }
});

test('question loading rejects changed repetition order and transfer priming placement', t => {
  const reordered = changedBundle(t, q => q.series_R.reverse());
  assert.throws(() => loadAgentQuestions(reordered), /order|repeat/i);
  const priming = changedBundle(t, q => { q.series_T[10].is_priming = true; });
  assert.throws(() => loadAgentQuestions(priming), /priming/i);
  const leakage = changedBundle(t, q => { q.series_T[0].criteria = ['The answer is X']; });
  assert.throws(() => loadAgentQuestions(leakage), /leakage/i);
  const duplicate = changedBundle(t, q => { q.series_T[10].objective = q.series_T[0].objective; });
  assert.throws(() => loadAgentQuestions(duplicate), /distinct|duplicate/i);
});

test('fixture verification rejects ancestor repositories, wrong revisions, dirty and writable checkouts', t => {
  const directory = mkdtempSync(join(tmpdir(), 't04-checkout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', directory]);
  writeFileSync(join(directory, 'source.c'), 'void caller(void) {}\n');
  writeFileSync(join(directory, '.gitignore'), 'ignored.txt\n');
  execFileSync('git', ['-C', directory, 'add', '.']);
  execFileSync('git', ['-C', directory, '-c', 'user.name=T04', '-c', 'user.email=t04@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test fixture']);
  writeFileSync(join(directory, 'source.c'), 'void changed(void) {}\n');
  writeFileSync(join(directory, 'ignored.txt'), 'also contamination\n');
  const result = verifyCheckout(directory);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /revision/i);
  assert.match(result.errors.join('\n'), /dirty|contaminat/i);
  assert.match(result.errors.join('\n'), /writable/i);
  assert.match(result.errors.join('\n'), /content|blob/i);
  const inside = join(directory, '.git');
  assert.equal(verifyCheckout(inside).ok, false);
});

test('the sealed question bundle validates against the actual read-only pinned PostgreSQL checkout', {
  skip: !existsSync(join(fixturePath, '.git')) && 'Set POSTGRES_FIXTURE to a pinned checkout',
}, () => {
  const result = validateBundle({ fixturePath, bundleDirectory });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.questionCount, 40);
  assert.equal(result.referenceCount, 40);
  assert.equal(result.checkout.observedSha, '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5');
  assert.equal(result.checkout.tree, 'fe2477270bb6148a031c443841a4d971627b6dec');
});

test('source validation rejects imaginary files and calls attributed to another real function', {
  skip: !existsSync(join(fixturePath, '.git')) && 'Set POSTGRES_FIXTURE to a pinned checkout',
}, t => {
  const missing = changedReferences(t, e => {
    e.expected_answers['R-Q1-R1'].source_functions[0].file = 'src/backend/access/transam/ckpt.c';
  });
  const missingResult = validateBundle({ fixturePath, bundleDirectory: missing });
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join('\n'), /untracked|nonexistent|missing source/i);
  const wrongCaller = changedReferences(t, e => {
    e.expected_answers['R-Q1-R1'].relations[0].from = 'pg_rewrite_query';
  });
  const wrongResult = validateBundle({ fixturePath, bundleDirectory: wrongCaller });
  assert.equal(wrongResult.ok, false);
  assert.match(wrongResult.errors.join('\n'), /caller|scope|call site/i);
});

test('transfer references must pair all ten priming questions with distinct later neighbors', {
  skip: !existsSync(join(fixturePath, '.git')) && 'Set POSTGRES_FIXTURE to a pinned checkout',
}, t => {
  const directory = changedReferences(t, e => {
    e.transfer_pairs[1].neighbor = e.transfer_pairs[0].neighbor;
  });
  const result = validateBundle({ fixturePath, bundleDirectory: directory });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /transfer pair/i);
});

test('shell verifier works from another directory and fails closed on a broken content seal', {
  skip: !existsSync(join(fixturePath, '.git')) && 'Set POSTGRES_FIXTURE to a pinned checkout',
}, t => {
  const command = join(bundleDirectory, 'verify-fixture.sh');
  const valid = spawnSync('bash', [command, '--fixture', fixturePath], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  const result = JSON.parse(valid.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.campaignAuthorized, false);
  const directory = changedBundle(t, q => {
    q.series_R.slice(0, 4).forEach(entry => { entry.objective += ' Changed.'; });
  });
  const invalid = spawnSync('bash', [command, '--fixture', fixturePath, '--bundle', directory], {
    cwd: tmpdir(), encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /hash mismatch/);
  assert.equal(JSON.parse(invalid.stdout).ok, false);
});

test('call evidence excludes comments, string literals and C control syntax', {
  skip: !existsSync(join(fixturePath, '.git')) && 'Set POSTGRES_FIXTURE to a pinned checkout',
}, t => {
  for (const [id, to, file, line] of [
    ['T-Q1-A1', 'base_yylex', 'src/backend/parser/parser.c', 52],
    ['R-Q1-R1', 'copyObject', 'src/backend/tcop/postgres.c', 640],
    ['T-Q1-A1', 'if', 'src/backend/parser/parser.c', 53],
  ]) {
    const directory = changedReferences(t, e => {
      const relation = e.expected_answers[id].relations[0];
      relation.to = to;
      relation.evidence = { file, startLine: line, endLine: line,
        revision: '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5',
        excerpt: readFileSync(join(fixturePath, file), 'utf8').split('\n')[line - 1] };
    });
    const result = validateBundle({ fixturePath, bundleDirectory: directory });
    assert.equal(result.ok, false, to);
    assert.match(result.errors.join('\n'), /call site|callee/i);
  }
});
