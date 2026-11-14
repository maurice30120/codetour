import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Local, model-free selection of stored scripts for one task. Everything here
// runs against the filesystem and the sandbox: it costs no model tokens.
const STOPWORDS = new Set(('a à au aux avec ce cet cette ces dans de des du dont elle elles en entre est et il ils je le la les leur leurs mais ne on ou où par pas pour que qui quoi sans se son sa ses sur sous tu tous tout très une un vous afin alors aussi autant bien car ce ci comme comment d dans de déjà dont du elle en encore entre est et furent ici il ils je la le les leur mais ne ni on ou où par pas pour que quand que quel quelle quels quelles qui quoi sans se ses si son sous sur te tes tout tous tu un une vers vos votre vos ce cet cette ces cette là lors lorsque mais ni or or donc').split(' '));

/** Words mentioned by the objective, most frequent first, with their mention count. */
export function extractCandidateTerms(objective, maxTerms = 24) {
  const counts = new Map();
  for (const match of String(objective).matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
    const word = match[0];
    if (STOPWORDS.has(word.toLowerCase())) continue;
    if (/^[a-z]+$/.test(word) && word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([term, mentions]) => ({ term, mentions })).slice(0, maxTerms);
}

// Code symbols (underscore, camelCase, acronym) outrank capitalized prose words
// ("Project", "Cite"), which outrank plain words ("code", "parsing") that occur
// everywhere in comments; among symbols, the least frequent term is the most
// targeted starting point for a first search.
const symbolScore = term => /_|[a-z][A-Z]|^[A-Z]{2,}$/.test(term) ? 2 : /[A-Z]/.test(term) ? 1 : 0;

export function rankTerms(entries, occurrences, maxTerms = 8) {
  return entries
    .filter(({ term }) => (occurrences.get(term) ?? 0) > 0)
    .sort((a, b) => symbolScore(b.term) - symbolScore(a.term) || b.mentions - a.mentions || (occurrences.get(a.term) ?? 0) - (occurrences.get(b.term) ?? 0) || a.term.localeCompare(b.term))
    .slice(0, maxTerms)
    .map(({ term }) => term);
}

async function walk(root, prefix = '', files = []) {
  for (const entry of await readdir(join(root, prefix || '.'), { withFileTypes: true })) {
    if (files.length >= 30000 || entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, name, files);
    else if (entry.isFile()) {
      try { if ((await stat(join(root, name))).size <= 1048576) files.push(name); } catch { /* unreadable file */ }
    }
  }
  return files;
}

/** Whole-identifier occurrences of each term across workspace files; local only. */
export async function countOccurrences(root, terms) {
  const totals = new Map(terms.map(term => [term, 0]));
  const patterns = new Map(terms.map(term => [term, new RegExp(`(?<![A-Za-z0-9_$])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_$])`, 'g')]));
  for (const file of await walk(root)) {
    const text = await readFile(join(root, file), 'utf8').catch(() => '');
    if (!text) continue;
    for (const [term, pattern] of patterns) totals.set(term, totals.get(term) + (text.match(pattern) ?? []).length);
  }
  return totals;
}

/** Whole-identifier occurrences of one term, grouped by workspace-relative directory. */
export async function termDirectories(root, term) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_$])`, 'g');
  const dirs = new Map();
  for (const file of await walk(root)) {
    const text = await readFile(join(root, file), 'utf8').catch(() => '');
    const count = text ? (text.match(pattern) ?? []).length : 0;
    if (!count) continue;
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    dirs.set(dir, (dirs.get(dir) ?? 0) + count);
  }
  return dirs;
}

/** Dominant directory prefix for a term, when it covers at least half of its hits. */
export function dominantPrefix(directories, hits) {
  const top = [...directories.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[0] && top[1] >= 3 && top[1] >= hits / 2 ? top[0] : null;
}

/**
 * Picks, for one task, the stored query script to reuse and the concrete term to
 * search, plus the list of stored functions to expose as named tools.
 * The first probe-passing query entry becomes `memory_search` with its best term;
 * other learned (non-primitive) parameterized entries become `memory_fn_<id8>`.
 */
export async function selectForTask(store, root, objective, probe, { maxTerms = 8, maxProbedEntries = 6, primitiveCodes = [] } = {}) {
  const primitives = new Set(primitiveCodes);
  const occurrences = await countOccurrences(root, extractCandidateTerms(objective).map(({ term }) => term));
  const candidates = rankTerms(extractCandidateTerms(objective), occurrences, maxTerms);
  let query = null;
  const namedTools = [];
  let probed = 0;
  for (const entry of store.catalog()) {
    const source = store.get(entry.id);
    if (!source) continue;
    const isQuery = entry.parameters.includes('query');
    let passes = false;
    if (isQuery && probed < maxProbedEntries) {
      probed++;
      passes = (await probe(source.code, store.sources())).status === 'pass';
    }
    if (isQuery && passes && !query && candidates.length) {
      // The first ranked term is the recommendation; occurrences are whole-word
      // counts over the workspace, so the sandbox substring search is not needed.
      const term = candidates[0];
      const hits = occurrences.get(term);
      const prefix = dominantPrefix(await termDirectories(root, term), hits);
      query = { id: entry.id, term, hits, ...(prefix ? { pathPrefix: prefix } : {}) };
      namedTools.push({ name: 'memory_search', id: entry.id, parameters: entry.parameters, required: ['query'], description: source.description || 'Reusable literal search tested on synthetic probes.' });
    } else if (entry.parameters.length > 0 && !primitives.has(source.code) && !(isQuery && !passes)) {
      namedTools.push({ name: `memory_fn_${entry.id.slice(0, 8)}`, id: entry.id, parameters: entry.parameters, required: entry.parameters, description: source.description || 'Reusable stored function.' });
    }
  }
  return { query, namedTools, candidates };
}
