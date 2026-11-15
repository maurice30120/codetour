import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeLiteralQuery } from '../parameter-probe.mjs';

test('query probe distinguishes a reusable search from hardcoded and empty results', async () => {
  assert.equal((await probeLiteralQuery('search(params.query)')).status, 'pass');
  assert.equal((await probeLiteralQuery('search("alpha")')).status, 'fail');
  assert.equal((await probeLiteralQuery('[]')).status, 'fail');
  assert.equal((await probeLiteralQuery('search(params.query).map(x=>read(x.file,1,3))')).status, 'pass');
});

test('query probe reports unsupported input contracts as inconclusive', async () => {
  assert.equal((await probeLiteralQuery('read(params.file,1,3)')).status, 'inconclusive');
});
