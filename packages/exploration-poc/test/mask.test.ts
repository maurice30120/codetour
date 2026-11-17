import assert from 'node:assert/strict';
import test from 'node:test';
import { maskObservations } from '../src/mask.ts';

const history = () => [
  { role: 'system', content: 'sys' },
  ...[1, 2, 3].flatMap(id => [
    { role: 'assistant', tool_calls: [{ id: `c${id}`, type: 'function', function: { name: 'readLines', arguments: JSON.stringify({ file: `f${id}.ts` }) } }] },
    { role: 'tool', tool_call_id: `c${id}`, content: `body${id}`.padEnd(2500, 'x') }
  ])
];

test('observation masking keeps the last results and stubs older ones', () => {
  const messages = history();
  const masked = maskObservations(messages, 1, new Map([['c1', 'c1']]));
  assert.match(masked[2].content, /c1.*readScratch/);
  assert.match(masked[2].content, /omitted.*readLines.*f1\.ts/);
  assert.match(masked[4].content, /omitted.*f2\.ts/);
  assert.ok(masked[6].content.startsWith('body3'));
  assert.match(masked[2].content, /"head":"body1/);
  assert.ok(messages[2].content.startsWith('body1'));
});

test('observation masking is disabled with keep = 0', () => {
  const messages = history();
  assert.equal(maskObservations(messages, 0), messages);
});

test('small results are never masked', () => {
  const messages = history().map(message => message.role === 'tool' ? { ...message, content: 'tiny' } : message);
  assert.equal(maskObservations(messages, 1)[2].content, 'tiny');
});
