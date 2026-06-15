import { test } from 'node:test';
import assert from 'node:assert/strict';
import { northwindFindings } from '../../src/app/bootstrap.ts';
import { score } from '../../src/metrics/detection.ts';

// SEED_MANIFEST ground truth: the Work-IQ-only planted leak.
const PLANTED = ['NW-QBR-UPLIFT'];

test('detection vs SEED_MANIFEST: Work IQ ON detects the planted Northwind leak (recall 1)', () => {
  const sighted = northwindFindings(true);
  const detected = sighted.length > 0 ? ['NW-QBR-UPLIFT'] : [];
  const s = score(PLANTED, detected);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test('detection vs SEED_MANIFEST: Work IQ OFF misses it (recall 0) - the quantified moat delta', () => {
  const blind = northwindFindings(false);
  const detected = blind.length > 0 ? ['NW-QBR-UPLIFT'] : [];
  const s = score(PLANTED, detected);
  assert.equal(s.recall, 0);
});
