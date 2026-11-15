import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenPostgres } from '../screen-postgres.mjs';

test('screen requires both raw parsing citations without claiming semantic correctness', () => {
  const result = { status: 'complete', entryPoints: [], components: [], relations: [{ evidence: [{ file: 'src/backend/tcop/postgres.c', startLine: 626, endLine: 626 }] }] };
  assert.deepEqual(screenPostgres('pg-parse', result).missing, [1083]);
  result.relations[0].evidence.push({ file: 'src/backend/tcop/postgres.c', startLine: 1083, endLine: 1083 });
  assert.equal(screenPostgres('pg-parse', result).status, 'citations_present');
  assert.equal(screenPostgres('pg-parse', { status: 'partial' }).status, 'incomplete');
});
