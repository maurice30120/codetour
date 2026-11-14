import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Fixture-specific necessary conditions, not a semantic validator or a Tour validator.
export function screen(task, result) {
  if (!result || result.status !== 'complete') return { status: 'incomplete', missing: [], unsupported: [] };
  const items = [...result.entryPoints, ...result.components];
  const relations = result.relations;
  const covers = (item, file, line) => item.evidence.some(e => e.file === file && e.startLine <= line && e.endLine >= line);
  const item = (pattern, file, line) => items.some(i => pattern.test(i.name) && covers(i, file, line));
  const relation = (from, to, file, line) => relations.some(r => from.test(r.from) && to.test(r.to) && covers(r, file, line));
  const checks = task === 'project-route' ? {
    postOrder: item(/postOrder|api\.js/i, 'src/api.js', 3),
    calculation: item(/totalPrice|math\.js/i, 'src/math.js', 2),
    firstCall: relation(/postOrder/i, /createOrder/i, 'src/api.js', 4),
    secondCall: relation(/createOrder/i, /totalPrice/i, 'src/order.js', 5),
  } : task === 'project-collaboration' ? {
    catalog: item(/Catalog|catalog\.js/i, 'src/catalog.js', 2),
    storageUse: item(/storage|Catalog|catalog\.js/i, 'src/catalog.js', 9) || relation(/Catalog/i, /storage/i, 'src/catalog.js', 9),
    loggerUse: item(/logger|Catalog|catalog\.js/i, 'src/catalog.js', 8) || relation(/Catalog/i, /logger/i, 'src/catalog.js', 8),
    orderCall: item(/createOrder|order\.js/i, 'src/order.js', 4) || relations.some(r => covers(r, 'src/order.js', 4)),
  } : task === 'project-transfer' ? {
    calculation: item(/totalPrice|math\.js/i, 'src/math.js', 2),
  } : null;
  if (!checks) return { status: 'unsupported_task', missing: [], unsupported: [] };
  const unsupported = relations.filter(r => {
    const names = `${r.from} ${r.to}`;
    // The fixture calls catalog.find on an injected argument. It never proves
    // that argument is an instance of the capitalized class Catalog.
    return /createOrder|order\.js/i.test(names) && /\bCatalog\b|src\/catalog\.js/.test(names);
  }).map(r => `${r.from} → ${r.to}`);
  const missing = Object.entries(checks).filter(([, value]) => !value).map(([name]) => name);
  return { status: missing.length || unsupported.length ? 'failed_screen' : 'passed_screen', missing, unsupported };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw Error('Usage: node screen-tour.mjs results.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  const rows = data.rows.map(row => ({ mode: row.mode, repetition: row.repetition, task: row.task, ...screen(row.task, row.result), metrics: row.result?.metrics ?? null }));
  console.log(JSON.stringify({ file, caveat: 'Fixture-specific necessary conditions only; manual semantic review remains required.', rows }, null, 2));
}
