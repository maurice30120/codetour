import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screen } from '../screen-tour.mjs';

const ev = (file, line) => [{ file, startLine: line, endLine: line }];
const fixture = () => ({ status: 'complete', entryPoints: [{ name: 'postOrder', evidence: ev('src/api.js', 3) }], components: [{ name: 'totalPrice', evidence: ev('src/math.js', 2) }], relations: [{ from: 'postOrder', to: 'createOrder', evidence: ev('src/api.js', 4) }, { from: 'createOrder', to: 'totalPrice', evidence: ev('src/order.js', 5) }] });
test('screen requires expected evidence and flags an unsupported class relation', () => {
  const result = fixture();
  assert.equal(screen('project-route', result).status, 'passed_screen');
  result.relations.pop();
  assert.ok(screen('project-route', result).missing.includes('secondCall'));
  result.relations.push({ from: 'createOrder', to: 'Catalog.find', evidence: ev('src/order.js', 4) });
  assert.equal(screen('project-route', result).unsupported.length, 1);
});
test('partial results and unknown tasks are not counted as passing', () => {
  assert.equal(screen('project-route', { status: 'partial' }).status, 'incomplete');
  assert.equal(screen('unseen', fixture()).status, 'unsupported_task');
});
