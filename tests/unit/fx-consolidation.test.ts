import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConsolidationError, FxRateBook, toReporting, consolidate, currencyConcentration,
} from '../../src/consolidation/fx-consolidation.ts';
import { money, type FxRate } from '../../src/money/money.ts';

function book(): FxRateBook {
  const b = new FxRateBook();
  b.add({ from: 'EUR', to: 'GBP', rate: 0.85, asOf: '2026-01-01' });
  b.add({ from: 'USD', to: 'GBP', rate: 0.8, asOf: '2026-01-01' });
  return b;
}

test('rate book rejects non-positive rate', () => {
  const b = new FxRateBook();
  assert.throws(() => b.add({ from: 'EUR', to: 'GBP', rate: 0, asOf: 'x' } as FxRate), ConsolidationError);
});

test('resolve returns identity for same currency', () => {
  assert.equal(book().resolve('GBP', 'GBP', '2026-01-01').rate, 1);
});

test('resolve finds direct and inverse rates, throws when missing', () => {
  const b = book();
  assert.equal(b.resolve('EUR', 'GBP', '2026-01-01').rate, 0.85);
  assert.ok(Math.abs(b.resolve('GBP', 'EUR', '2026-01-01').rate - 1 / 0.85) < 1e-9); // inverse
  assert.throws(() => b.resolve('JPY', 'GBP', '2026-01-01'), ConsolidationError);
});

test('has reflects identity, direct, inverse', () => {
  const b = book();
  assert.equal(b.has('GBP', 'GBP', 'x'), true);
  assert.equal(b.has('EUR', 'GBP', '2026-01-01'), true);
  assert.equal(b.has('GBP', 'EUR', '2026-01-01'), true);
  assert.equal(b.has('JPY', 'GBP', '2026-01-01'), false);
});

test('toReporting passes through same currency and converts otherwise', () => {
  const b = book();
  assert.deepEqual(toReporting(money(100_00, 'GBP'), 'GBP', b, '2026-01-01'), money(100_00, 'GBP'));
  assert.equal(toReporting(money(100_00, 'EUR'), 'GBP', b, '2026-01-01').amount, 8500);
});

test('consolidate mixes currencies into reporting total with breakdown', () => {
  const b = book();
  const c = consolidate(
    [money(100_00, 'GBP'), money(100_00, 'EUR'), money(100_00, 'USD'), money(50_00, 'EUR')],
    'GBP', b, '2026-01-01',
  );
  assert.equal(c.reporting, 'GBP');
  // 10000 + 8500 + 8000 + 4250 = 30750
  assert.equal(c.total.amount, 30750);
  assert.equal(c.lines.length, 4);
  // breakdown sorted by converted desc; EUR aggregates 150.00 -> 12750
  const eur = c.currencyBreakdown.find((x) => x.currency === 'EUR')!;
  assert.equal(eur.original.amount, 150_00);
  assert.equal(eur.converted.amount, 12750);
});

test('currencyConcentration sums to ~1 and handles zero total', () => {
  const b = book();
  const c = consolidate([money(100_00, 'GBP'), money(100_00, 'EUR')], 'GBP', b, '2026-01-01');
  const conc = currencyConcentration(c);
  const totalShare = conc.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(totalShare - 1) < 1e-9);
  const zero = consolidate([], 'GBP', b, '2026-01-01');
  assert.deepEqual(currencyConcentration(zero), []);
  // explicit zero-total branch with a zero amount
  const zeroAmt = consolidate([money(0, 'GBP')], 'GBP', b, '2026-01-01');
  assert.equal(currencyConcentration(zeroAmt)[0]!.share, 0);
});
