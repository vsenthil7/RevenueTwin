import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMapping, applyMapping, csvTemplate, MappingError, ALL_COLUMNS, OPTIONAL_COLUMNS } from '../../src/import/mapping.ts';

test('suggestMapping maps common finance aliases to canonical columns', () => {
  const m = suggestMapping(['Account Name', 'Invoice Number', 'Expected Amount', 'Invoice Amount', 'CCY']);
  assert.equal(m['Account Name'], 'customer');
  assert.equal(m['Invoice Number'], 'line_id');
  assert.equal(m['Expected Amount'], 'expected');
  assert.equal(m['Invoice Amount'], 'actual');
  assert.equal(m['CCY'], 'currency');
});

test('suggestMapping ignores unknown headers', () => {
  const m = suggestMapping(['Wibble', 'Random Column']);
  assert.deepEqual(m, {});
});

test('suggestMapping matches case- and punctuation-insensitively', () => {
  const m = suggestMapping(['CUSTOMER_NAME', 'days outstanding']);
  assert.equal(m['CUSTOMER_NAME'], 'customer');
  assert.equal(m['days outstanding'], 'age_days');
});

test('applyMapping renames source keys to canonical and drops unmapped keys', () => {
  const recs = [{ 'Account': 'Acme', 'Invoice Amount': '100', 'Junk': 'x' }];
  const mapping = { 'Account': 'customer', 'Invoice Amount': 'actual' };
  const out = applyMapping(recs, mapping);
  assert.deepEqual(out, [{ customer: 'Acme', actual: '100' }]);
});

test('applyMapping skips a source key absent from a given row', () => {
  const recs = [{ 'Account': 'Acme' }];
  const mapping = { 'Account': 'customer', 'Invoice Amount': 'actual' };
  const out = applyMapping(recs, mapping);
  assert.deepEqual(out, [{ customer: 'Acme' }]);
});

test('applyMapping throws when two source headers map to the same target', () => {
  const mapping = { 'Billed': 'actual', 'Invoice Amount': 'actual' };
  assert.throws(() => applyMapping([], mapping), MappingError);
});

test('csvTemplate has the canonical header and one example row', () => {
  const t = csvTemplate();
  const lines = t.trim().split('\n');
  assert.equal(lines[0]!, ALL_COLUMNS.join(','));
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.includes('Acme Corp'));
});

test('OPTIONAL_COLUMNS are included in ALL_COLUMNS', () => {
  for (const c of OPTIONAL_COLUMNS) assert.ok(ALL_COLUMNS.includes(c));
});
