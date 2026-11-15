import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const POSTGRES_SHA = '70c4a57b64d39c526eb4c44a925eb92a6e56f3c5';

function digest(value, algorithm = 'sha256') {
  return createHash(algorithm).update(value).digest('hex');
}

function git(directory, args, encoding = 'utf8') {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  for (const name of Object.keys(env)) {
    if (name.startsWith('GIT_') && name !== 'GIT_OPTIONAL_LOCKS') delete env[name];
  }
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', directory, ...args], {
    encoding, env, timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function verifyCheckout(fixturePath) {
  const result = { ok: false, errors: [], observedSha: null, tree: null, fixtureHash: null,
    cleanTree: false, readOnly: false, trackedFiles: [] };
  try {
    const root = realpathSync(fixturePath);
    if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root ||
        !lstatSync(join(root, '.git')).isDirectory()) throw new Error('Fixture must be its own Git checkout root');
    result.observedSha = git(root, ['rev-parse', 'HEAD']).trim();
    if (result.observedSha !== POSTGRES_SHA) result.errors.push(`Fixture revision mismatch: ${result.observedSha}`);
    result.tree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
    const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']);
    result.cleanTree = status.length === 0;
    if (!result.cleanTree) result.errors.push('Dirty or contaminated fixture (tracked, untracked or ignored files)');
    const listing = git(root, ['ls-tree', '-rz', 'HEAD'], null);
    result.fixtureHash = `sha256:${digest(listing)}`;
    for (const entry of listing.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
      if (!match || !['100644', '100755'].includes(match[1])) throw new Error('Unsupported fixture entry or submodule');
      const [, mode, blob, file] = match;
      const target = join(root, file);
      const stat = lstatSync(target);
      if (!stat.isFile()) throw new Error(`Fixture entry is not a regular file: ${file}`);
      const content = readFileSync(target);
      const actual = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
      if (actual !== blob) result.errors.push(`Fixture content/blob mismatch: ${file}`);
      if (Boolean(stat.mode & 0o111) !== (mode === '100755')) result.errors.push(`Fixture executable mode mismatch: ${file}`);
      result.trackedFiles.push(file);
    }
    let writable = null;
    function inspect(directory) {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink()) throw new Error(`Fixture contains a symlink: ${directory}`);
      if (stat.mode & 0o222) writable ??= directory;
      if (stat.isDirectory()) for (const child of readdirSync(directory)) inspect(join(directory, child));
    }
    inspect(root);
    result.readOnly = writable === null;
    if (writable) result.errors.push(`Writable fixture entry: ${writable}`);
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message);
  }
  return result;
}

export function loadAgentQuestions(bundleDirectory) {
  const questions = JSON.parse(readFileSync(join(bundleDirectory, 'postgres-questions.json'), 'utf8'));
  const topFields = ['version', 'spec_version', 'postgres_sha', 'date', 'description', 'series_R', 'series_T'];
  if (Object.keys(questions).some(key => !topFields.includes(key))) throw new Error('Answer leakage in question metadata');
  if (questions.postgres_sha !== POSTGRES_SHA) throw new Error('Question set revision mismatch');
  for (const series of ['R', 'T']) {
    const entries = questions[`series_${series}`];
    if (!Array.isArray(entries) || entries.length !== 20) throw new Error(`Expected 20 ${series} questions`);
    for (const [index, q] of entries.entries()) {
      const allowed = ['id', 'objective', 'phase', 'postgres_sha', 'repeat_index', 'series',
        ...(series === 'T' ? ['is_priming'] : [])];
      if (Object.keys(q).some(key => !allowed.includes(key))) throw new Error(`Answer leakage: ${q.id}`);
      if (allowed.some(key => !(key in q))) throw new Error(`Missing question field: ${q.id}`);
      if (q.postgres_sha !== POSTGRES_SHA || q.series !== series) throw new Error(`Question revision/series mismatch: ${q.id}`);
      if (typeof q.objective !== 'string' || q.objective.length < 30) throw new Error(`Missing objective: ${q.id}`);
      if (series === 'R') {
        const group = Math.floor(index / 4) + 1;
        const repeat = index % 4 + 1;
        if (q.id !== `R-Q${group}-R${repeat}` || q.repeat_index !== repeat || q.phase !== 'repetition' ||
            q.objective !== entries[(group - 1) * 4].objective) throw new Error('Invalid repetition order');
      } else if (q.id !== `T-Q${index + 1}-${index < 10 ? 'A1' : 'N1'}` || q.repeat_index !== 1 ||
                 q.phase !== 'transfer' || q.is_priming !== (index < 10)) {
        throw new Error('Invalid transfer order or priming placement');
      }
    }
    const uniqueObjectives = new Set(entries.map(q => q.objective));
    if (uniqueObjectives.size !== (series === 'R' ? 5 : 20)) throw new Error(`Expected distinct ${series} objectives`);
  }
  return questions;
}

function cTokens(source) {
  const tokens = [];
  let offset = 0;
  let line = 1;
  function skip(end) {
    line += source.slice(offset, end).split('\n').length - 1;
    offset = end;
  }
  while (offset < source.length) {
    const char = source[offset];
    if (/\s/.test(char)) { skip(offset + 1); continue; }
    if (source.startsWith('//', offset)) {
      const end = source.indexOf('\n', offset);
      skip(end < 0 ? source.length : end);
      continue;
    }
    if (source.startsWith('/*', offset)) {
      const end = source.indexOf('*/', offset + 2);
      if (end < 0) throw new Error('Unterminated C comment');
      skip(end + 2);
      continue;
    }
    if (char === '#' && source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset).trim() === '') {
      let end = offset;
      do {
        end = source.indexOf('\n', end + 1);
      } while (end >= 0 && source[end - 1] === '\\');
      skip(end < 0 ? source.length : end + 1);
      continue;
    }
    if (char === '"' || char === "'") {
      let end = offset + 1;
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1;
      if (end >= source.length) throw new Error('Unterminated C literal');
      skip(end + 1);
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(offset));
    const value = identifier ? identifier[0] : char;
    tokens.push({ value, line });
    offset += value.length;
  }
  return tokens;
}

function closing(tokens, start, open, close) {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].value === open) depth++;
    if (tokens[index].value === close && --depth === 0) return index;
  }
  throw new Error(`Unbalanced C delimiter: ${open}`);
}

function functionBody(tokens, name) {
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index].value;
    if (depth === 0 && value === name && tokens[index + 1]?.value === '(') {
      const parameterEnd = closing(tokens, index + 1, '(', ')');
      if (tokens[parameterEnd + 1]?.value === '{') {
        const end = closing(tokens, parameterEnd + 1, '{', '}');
        return { startLine: tokens[index].line, endLine: tokens[end].line,
          tokens: tokens.slice(parameterEnd + 2, end) };
      }
    }
    if (value === '{') depth++;
    if (value === '}') depth--;
  }
  throw new Error(`Missing source function: ${name}`);
}

function validateReferences(expected, all, fixturePath, checkout) {
  const pairs = expected.transfer_pairs;
  if (!Array.isArray(pairs) || pairs.length !== 10 || pairs.some((pair, index) =>
    pair.priming !== `T-Q${index + 1}-A1` || pair.neighbor !== `T-Q${index + 11}-N1` || !pair.basis)) {
    throw new Error('Invalid transfer pairing: require ten distinct priming/neighbor pairs');
  }
  const tracked = new Set(checkout.trackedFiles);
  const root = realpathSync(fixturePath);
  const sources = new Map();
  function source(file) {
    if (typeof file !== 'string' || isAbsolute(file) || file.includes('\\') || normalize(file) !== file ||
        file.startsWith('../') || !tracked.has(file)) throw new Error(`Untracked or nonexistent source: ${file}`);
    if (!sources.has(file)) {
      const target = realpathSync(join(root, file));
      if (!target.startsWith(root + sep)) throw new Error('Source escapes fixture');
      const text = readFileSync(target, 'utf8');
      sources.set(file, { lines: text.split('\n'), tokens: cTokens(text) });
    }
    return sources.get(file);
  }
  function citation(c) {
    const file = source(c.file);
    if (c.revision !== POSTGRES_SHA) throw new Error('Citation revision mismatch');
    if (!Number.isInteger(c.startLine) || !Number.isInteger(c.endLine) || c.startLine < 1 ||
        c.endLine < c.startLine || c.endLine > file.lines.length) throw new Error('Citation line bounds invalid');
    if (c.excerpt !== undefined && c.excerpt !== file.lines.slice(c.startLine - 1, c.endLine).join('\n')) {
      throw new Error(`Citation excerpt mismatch: ${c.file}:${c.startLine}`);
    }
    if (c.symbol) {
      const body = functionBody(file.tokens, c.symbol);
      if (body.startLine !== c.startLine || body.endLine !== c.endLine) throw new Error(`Function citation scope mismatch: ${c.symbol}`);
    }
    return file;
  }
  for (const q of all) {
    const answer = expected.expected_answers[q.id];
    if (answer.question_id !== q.id || !answer.source_functions?.length || !answer.relations?.length ||
        !answer.verification_criteria?.length || !answer.semantic_checks?.length || !answer.false_claims?.length ||
        answer.proof_paths?.length < 2) throw new Error(`Incomplete semantic reference: ${q.id}`);
    for (const file of answer.expected_areas) source(file);
    for (const c of answer.source_functions) citation(c);
    for (const criterion of answer.verification_criteria) {
      if (!criterion.criteria || !criterion.evidence?.length) throw new Error('Missing semantic criterion/evidence');
      criterion.evidence.forEach(citation);
    }
    for (const path of answer.proof_paths) {
      if (!path.steps?.length || !path.evidence?.length) throw new Error('Incomplete proof path');
      path.evidence.forEach(citation);
    }
    for (const relation of answer.relations) {
      const c = relation.evidence;
      const file = citation(c);
      if (relation.type !== 'calls' || !relation.condition || relation.critical !== true) throw new Error('Incomplete scoped call relation');
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(relation.to) ||
          ['if', 'for', 'while', 'switch', 'sizeof', '_Alignof', 'return', 'do', 'else', 'case'].includes(relation.to)) {
        throw new Error(`Invalid call callee: ${relation.to}`);
      }
      if (!answer.source_functions.some(s => s.file === c.file && s.symbol === relation.from)) {
        throw new Error(`Undeclared caller scope: ${relation.from}`);
      }
      const body = functionBody(file.tokens, relation.from);
      if (!body.tokens.some((token, i) => token.value === relation.to && body.tokens[i + 1]?.value === '(' &&
          token.line >= c.startLine && token.line <= c.endLine && !['.', '>'].includes(body.tokens[i - 1]?.value))) {
        throw new Error(`Missing call site in caller scope: ${relation.from} -> ${relation.to}`);
      }
    }
  }
}

export function validateBundle({ fixturePath, bundleDirectory }) {
  const checkout = verifyCheckout(fixturePath);
  const result = { ok: false, errors: [...checkout.errors], checkout, questionCount: 0, referenceCount: 0 };
  try {
    const questions = loadAgentQuestions(bundleDirectory);
    const manifest = JSON.parse(readFileSync(join(bundleDirectory, 'manifest.json'), 'utf8'));
    const expected = JSON.parse(readFileSync(join(bundleDirectory, 'postgres-expected-answers.json'), 'utf8'));
    const all = [...questions.series_R, ...questions.series_T];
    result.questionCount = all.length;
    result.referenceCount = Object.keys(expected.expected_answers).length;
    if (manifest.postgres_sha !== POSTGRES_SHA || expected.postgres_sha !== POSTGRES_SHA) throw new Error('Bundle revision mismatch');
    if (manifest.fixture_hash !== checkout.fixtureHash || manifest.fixture_tree !== checkout.tree) {
      result.errors.push('Fixture tree/hash mismatch');
    }
    for (const [file, field] of [['postgres-questions.json', 'questions_hash'], ['postgres-expected-answers.json', 'expected_answers_hash']]) {
      if (manifest[field] !== `sha256:${digest(readFileSync(join(bundleDirectory, file)))}`) result.errors.push(`Sealed hash mismatch: ${file}`);
    }
    if (result.referenceCount !== all.length || all.some(q => !expected.expected_answers[q.id])) throw new Error('Reference/question ids mismatch');
    for (const series of ['R', 'T']) {
      if (JSON.stringify(manifest.request_order[series]) !== JSON.stringify(questions[`series_${series}`].map(q => q.id))) {
        result.errors.push(`Manifest request order mismatch: ${series}`);
      }
    }
    validateReferences(expected, all, fixturePath, checkout);
    result.ok = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { fixture: { type: 'string' }, bundle: { type: 'string' } } });
    const bundleDirectory = resolve(values.bundle || fileURLToPath(new URL('.', import.meta.url)));
    const fixturePath = resolve(values.fixture || join(bundleDirectory, 'postgres'));
    const result = validateBundle({ fixturePath, bundleDirectory });
    const { trackedFiles, ...checkout } = result.checkout;
    console.log(JSON.stringify({ ...result, checkout: { ...checkout, trackedFileCount: trackedFiles.length },
      fixturePath, campaignAuthorized: false, semanticValidation: 'Independent blind evaluation required' }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [error.message], campaignAuthorized: false }));
    process.exitCode = 1;
  }
}
