import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFromSource, ImportError } from '../../src/import/source-import.ts';

const HEADER = 'customer,line_id,type,expected,actual,currency';
const ROW = 'acme,INV-1,price_changed,12000,10800,GBP';

test('importFromSource: fetches CSV from a source and imports it', async () => {
  const fetcher = async () => [HEADER, ROW].join('\n');
  const r = await importFromSource('stripe-export', fetcher);
  assert.equal(r.source, 'stripe-export');
  assert.ok(r.fetchedBytes > 0);
  assert.equal(r.result.cases.length, 1);
  assert.equal(r.csv.includes('acme'), true);
});

test('importFromSource: wraps a fetch failure as ImportError', async () => {
  const fetcher = async () => { throw new Error('connection refused'); };
  await assert.rejects(() => importFromSource('sftp', fetcher), ImportError);
  await assert.rejects(() => importFromSource('sftp', fetcher), /fetch failed/);
});

test('importFromSource: empty source is rejected', async () => {
  await assert.rejects(() => importFromSource('url', async () => ''), /returned no data/);
  await assert.rejects(() => importFromSource('url', async () => '   '), /returned no data/);
});
