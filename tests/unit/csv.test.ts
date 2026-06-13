import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords } from '../../src/import/csv.ts';

test('parseCsv: basic rows and trailing newline', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv: no trailing newline still flushes last row', () => {
  const rows = parseCsv('a,b\n1,2');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('parseCsv: quoted field with embedded comma and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x,y",z\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,y', 'z']]);
});

test('parseCsv: escaped double-quote inside quotes', () => {
  const rows = parseCsv('"he said ""hi""",b');
  assert.deepEqual(rows, [['he said "hi"', 'b']]);
});

test('parseCsv: empty string yields no rows', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('parseCsvRecords: maps header to values, pads short rows', () => {
  const recs = parseCsvRecords('a,b,c\n1,2\n');
  assert.equal(recs.length, 1);
  assert.equal(recs[0]!.a, '1'); assert.equal(recs[0]!.b, '2'); assert.equal(recs[0]!.c, '');
});

test('parseCsvRecords: empty input yields []', () => {
  assert.deepEqual(parseCsvRecords(''), []);
});

test('parseCsvRecords: duplicate header throws', () => {
  assert.throws(() => parseCsvRecords('a,a\n1,2'), /duplicate column/);
});

test('parseCsvRecords: empty header name throws', () => {
  assert.throws(() => parseCsvRecords('a,,c\n1,2,3'), /empty column/);
});
