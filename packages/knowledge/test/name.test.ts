import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCanonicalName } from '../src/index';

// The canonical-name rule is shared by Memory Methods and Knowledge entries
// (ADR 0036, ADR 0039): one identifier convention, one validator.
test('a canonical name is a usable TypeScript identifier equal to the entry name', () => {
  for (const name of ['searchPostgresIndexes', 'SearchPostgresIndexes', 'search_postgres_indexes', '$cache', '_draft']) {
    assert.equal(validateCanonicalName(name).ok, true, name);
  }
  for (const name of ['', 'not-valid!', 'search-indexes', '1st', 'with space', 'class', 'await']) {
    assert.equal(validateCanonicalName(name).ok, false, name);
  }
});
