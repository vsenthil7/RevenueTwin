import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMismatch, resolveMismatch, isOpen, MismatchError } from '../../src/intent/contract-intent-mismatch.ts';

function intent(o: Record<string, unknown> = {}) {
  return { id: 'i1', customerId: 'northwind', source: 'qbr' as const, capturedAt: '2026-03-01T00:00:00.000Z',
    extractedSpan: 'agreed 12% uplift at the March QBR', intentType: 'price_increase', upliftPercent: 12, confidence: 0.9, ...o };
}
function term(o: Record<string, unknown> = {}) {
  return { id: 't1', contractId: 'c1', product: 'Platform', unitPrice: { amount: 100000, currency: 'GBP' as const },
    quantity: 10, billingPeriod: 'annual' as const, escalatorPercent: 3, ...o };
}

test('detectMismatch: price uplift beyond escalator is a scored mismatch', () => {
  const m = detectMismatch('m1', intent() as never, term() as never);
  assert.equal(m.kind, 'uplift_not_in_contract');
  assert.ok(m.score > 0);
  assert.ok(m.contractPosition.includes('3'));
  assert.ok(m.intentPosition.includes('12'));
  assert.equal(m.resolution, 'unresolved');
  assert.ok(isOpen(m));
});

test('detectMismatch: null contract term -> entirely uncaptured intent', () => {
  const m = detectMismatch('m2', intent() as never, null);
  assert.equal(m.kind, 'uplift_not_in_contract');
  assert.ok(m.contractPosition.includes('No contract term'));
});

test('detectMismatch: small uplift gap still flags with lower score factor', () => {
  const m = detectMismatch('m3', intent({ upliftPercent: 5 }) as never, term({ escalatorPercent: 3 }) as never);
  assert.equal(m.kind, 'uplift_not_in_contract');
  assert.ok(m.score > 0);
});

test('detectMismatch: discount grant', () => {
  const m = detectMismatch('m4', intent({ intentType: 'discount_grant', upliftPercent: undefined }) as never, term() as never);
  assert.equal(m.kind, 'discount_not_in_contract');
});

test('detectMismatch: seat expansion', () => {
  const m = detectMismatch('m5', intent({ intentType: 'seat_expansion', upliftPercent: undefined }) as never, term() as never);
  assert.equal(m.kind, 'quantity_mismatch');
});

test('detectMismatch: aligned -> no_mismatch', () => {
  const m = detectMismatch('m6', intent({ intentType: 'price_increase', upliftPercent: 3 }) as never, term({ escalatorPercent: 3 }) as never);
  assert.equal(m.kind, 'no_mismatch');
  assert.ok(!isOpen(m));
});

test('resolveMismatch: human picks a side', () => {
  const m = detectMismatch('m7', intent() as never, term() as never);
  const r = resolveMismatch(m, 'amend_contract');
  assert.equal(r.resolution, 'amend_contract');
  assert.ok(!isOpen(r));
});

test('resolveMismatch: cannot resolve a non-mismatch', () => {
  const m = detectMismatch('m8', intent({ upliftPercent: 3 }) as never, term({ escalatorPercent: 3 }) as never);
  assert.throws(() => resolveMismatch(m, 'honor_contract'), MismatchError);
});

test('resolveMismatch: resolution must pick a side (not unresolved)', () => {
  const m = detectMismatch('m9', intent() as never, term() as never);
  assert.throws(() => resolveMismatch(m, 'unresolved'), MismatchError);
});

test('detectMismatch: null term with no quantified uplift', () => {
  const m = detectMismatch('m10', intent({ upliftPercent: undefined }) as never, null);
  assert.ok(m.intentPosition.includes('no quantified uplift'));
});

test('detectMismatch: large gap (>=5) gets full score factor', () => {
  const m = detectMismatch('m11', intent({ upliftPercent: 12 }) as never, term({ escalatorPercent: 3 }) as never);
  // gap = 9 >= 5 -> factor 1 -> score = confidence
  assert.equal(m.score, 0.9);
});

test('detectMismatch: price_increase with undefined uplift uses 0 fallback (no mismatch vs positive escalator)', () => {
  const m = detectMismatch('m12', intent({ upliftPercent: undefined }) as never, term({ escalatorPercent: 3 }) as never);
  // (undefined ?? 0) = 0, not > 3 -> falls through to no_mismatch
  assert.equal(m.kind, 'no_mismatch');
});
