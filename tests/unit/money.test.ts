import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  money, add, subtract, compare, equals, isZero, negate,
  applyPercentage, multiplyByQuantity, convertFx, allocate, sum,
  toDecimal, fromDecimal, format, MoneyError,
  type FxRate,
} from '../../src/money/money.ts';

test('money() constructs exact minor-unit values', () => {
  const m = money(1200, 'GBP');
  assert.equal(m.amount, 1200);
  assert.equal(m.currency, 'GBP');
});

test('money() rejects non-integer amounts', () => {
  assert.throws(() => money(12.5, 'GBP'), MoneyError);
});

test('money() rejects non-finite amounts', () => {
  assert.throws(() => money(Number.POSITIVE_INFINITY, 'GBP'), MoneyError);
  assert.throws(() => money(Number.NaN, 'GBP'), MoneyError);
});

test('money() rejects invalid currency', () => {
  assert.throws(() => money(100, ''), MoneyError);
  // @ts-expect-error deliberate bad input
  assert.throws(() => money(100, undefined), MoneyError);
});

test('add sums same-currency amounts', () => {
  assert.deepEqual(add(money(100, 'GBP'), money(250, 'GBP')), { amount: 350, currency: 'GBP' });
});

test('add rejects currency mismatch', () => {
  assert.throws(() => add(money(100, 'GBP'), money(100, 'USD')), MoneyError);
});

test('subtract subtracts same-currency amounts', () => {
  assert.deepEqual(subtract(money(500, 'GBP'), money(200, 'GBP')), { amount: 300, currency: 'GBP' });
});

test('subtract rejects currency mismatch', () => {
  assert.throws(() => subtract(money(100, 'GBP'), money(100, 'EUR')), MoneyError);
});

test('compare returns -1, 0, 1', () => {
  assert.equal(compare(money(100, 'GBP'), money(200, 'GBP')), -1);
  assert.equal(compare(money(200, 'GBP'), money(200, 'GBP')), 0);
  assert.equal(compare(money(300, 'GBP'), money(200, 'GBP')), 1);
});

test('compare rejects currency mismatch', () => {
  assert.throws(() => compare(money(100, 'GBP'), money(100, 'USD')), MoneyError);
});

test('equals checks amount and currency', () => {
  assert.equal(equals(money(100, 'GBP'), money(100, 'GBP')), true);
  assert.equal(equals(money(100, 'GBP'), money(101, 'GBP')), false);
  assert.equal(equals(money(100, 'GBP'), money(100, 'USD')), false);
});

test('isZero detects zero', () => {
  assert.equal(isZero(money(0, 'GBP')), true);
  assert.equal(isZero(money(1, 'GBP')), false);
});

test('negate flips sign', () => {
  assert.deepEqual(negate(money(100, 'GBP')), { amount: -100, currency: 'GBP' });
});

test('applyPercentage scales and rounds half-away-from-zero', () => {
  assert.deepEqual(applyPercentage(money(1000, 'GBP'), 100), { amount: 1000, currency: 'GBP' });
  assert.deepEqual(applyPercentage(money(1000, 'GBP'), 12.5), { amount: 125, currency: 'GBP' });
  // 101 * 50% = 50.5 -> 51 (away from zero)
  assert.deepEqual(applyPercentage(money(101, 'GBP'), 50), { amount: 51, currency: 'GBP' });
  // negative half-away-from-zero: -101 * 50% = -50.5 -> -51
  assert.deepEqual(applyPercentage(money(-101, 'GBP'), 50), { amount: -51, currency: 'GBP' });
});

test('applyPercentage rejects non-finite percent', () => {
  assert.throws(() => applyPercentage(money(100, 'GBP'), Number.NaN), MoneyError);
});

test('multiplyByQuantity multiplies by integer qty', () => {
  assert.deepEqual(multiplyByQuantity(money(150, 'GBP'), 3), { amount: 450, currency: 'GBP' });
  assert.deepEqual(multiplyByQuantity(money(150, 'GBP'), 0), { amount: 0, currency: 'GBP' });
});

test('multiplyByQuantity rejects non-integer or negative qty', () => {
  assert.throws(() => multiplyByQuantity(money(100, 'GBP'), 2.5), MoneyError);
  assert.throws(() => multiplyByQuantity(money(100, 'GBP'), -1), MoneyError);
});

test('convertFx converts and rounds', () => {
  const r: FxRate = { from: 'GBP', to: 'USD', rate: 1.25, asOf: '2026-01-01' };
  assert.deepEqual(convertFx(money(1000, 'GBP'), r), { amount: 1250, currency: 'USD' });
  // asOf arg accepted
  assert.deepEqual(convertFx(money(1000, 'GBP'), r, '2026-02-01'), { amount: 1250, currency: 'USD' });
});

test('convertFx rejects currency mismatch on rate.from', () => {
  const r: FxRate = { from: 'EUR', to: 'USD', rate: 1.1, asOf: '2026-01-01' };
  assert.throws(() => convertFx(money(1000, 'GBP'), r), MoneyError);
});

test('convertFx rejects non-positive or non-finite rate', () => {
  assert.throws(() => convertFx(money(1000, 'GBP'), { from: 'GBP', to: 'USD', rate: 0, asOf: 'x' }), MoneyError);
  assert.throws(() => convertFx(money(1000, 'GBP'), { from: 'GBP', to: 'USD', rate: Number.POSITIVE_INFINITY, asOf: 'x' }), MoneyError);
});

test('allocate distributes exactly with largest-remainder', () => {
  const parts = allocate(money(1000, 'GBP'), [1, 1, 1]);
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), 1000);
  // 334/333/333 in some order summing to 1000
  assert.deepEqual(parts.map((p) => p.amount).sort((a, b) => a - b), [333, 333, 334]);
});

test('allocate handles negative totals (sign preserved, exact sum)', () => {
  const parts = allocate(money(-1000, 'GBP'), [1, 1, 1]);
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), -1000);
});

test('allocate with zero remainder needs no distribution', () => {
  const parts = allocate(money(900, 'GBP'), [1, 1, 1]);
  assert.deepEqual(parts.map((p) => p.amount), [300, 300, 300]);
});

test('allocate rejects empty / negative / zero-sum weights', () => {
  assert.throws(() => allocate(money(100, 'GBP'), []), MoneyError);
  assert.throws(() => allocate(money(100, 'GBP'), [-1, 2]), MoneyError);
  assert.throws(() => allocate(money(100, 'GBP'), [0, 0]), MoneyError);
});

test('sum reduces same-currency list with zero seed', () => {
  assert.deepEqual(sum([money(100, 'GBP'), money(250, 'GBP')], 'GBP'), { amount: 350, currency: 'GBP' });
  assert.deepEqual(sum([], 'GBP'), { amount: 0, currency: 'GBP' });
});

test('toDecimal and fromDecimal round-trip', () => {
  assert.equal(toDecimal(money(1250, 'GBP')), 12.5);
  assert.deepEqual(fromDecimal(12.5, 'GBP'), { amount: 1250, currency: 'GBP' });
  // negative rounding boundary
  assert.deepEqual(fromDecimal(-0.005, 'GBP'), { amount: -1, currency: 'GBP' });
});

test('fromDecimal rejects non-finite', () => {
  assert.throws(() => fromDecimal(Number.NaN, 'GBP'), MoneyError);
});

test('format renders major units with currency', () => {
  assert.equal(format(money(1250, 'GBP')), 'GBP 12.50');
});

test('allocate: uneven weights pin exact positions (kills sort/division/loop mutants)', () => {
  // total 1000, weights 1:2:7 -> exact 100/200/700, no remainder
  const parts = allocate(money(1000, 'GBP'), [1, 2, 7]);
  assert.deepEqual(parts.map((p) => p.amount), [100, 200, 700]);
});

test('allocate: remainder goes to the largest fractional part, by position', () => {
  // total 10, weights 1:1:1 -> exact 3.33/3.33/3.33, floors 3/3/3, remainder 1
  // equal fracs -> tie broken by index -> first element gets the extra unit
  const parts = allocate(money(10, 'GBP'), [1, 1, 1]);
  assert.deepEqual(parts.map((p) => p.amount), [4, 3, 3]);
});

test('allocate: distinct fractional parts route the remainder to the biggest frac', () => {
  // total 100, weights 3:3:4 -> exact 30/30/40 exact, no remainder
  const even = allocate(money(100, 'GBP'), [3, 3, 4]);
  assert.deepEqual(even.map((p) => p.amount), [30, 30, 40]);
  // total 7, weights 1:1:1 -> exact 2.33/2.33/2.33, floors 2/2/2, remainder 1 -> index 0
  const odd = allocate(money(7, 'GBP'), [1, 1, 1]);
  assert.deepEqual(odd.map((p) => p.amount), [3, 2, 2]);
});

test('allocate: negative total preserves sign at exact positions', () => {
  const parts = allocate(money(-1000, 'GBP'), [1, 2, 7]);
  assert.deepEqual(parts.map((p) => p.amount), [-100, -200, -700]);
});

test('money: rejects a non-finite amount (kills isFinite conditional)', () => {
  assert.throws(() => money(Infinity, 'GBP'), MoneyError);
  assert.throws(() => money(NaN, 'GBP'), MoneyError);
});

test('allocate: a zero weight is allowed and receives nothing (kills w<0 vs w<=0)', () => {
  // weights [0,1,1]: zero-weight element gets 0, others split the total
  const parts = allocate(money(1000, 'GBP'), [0, 1, 1]);
  assert.deepEqual(parts.map((p) => p.amount), [0, 500, 500]);
});

test('allocate: zero total yields all-zero parts with positive sign (kills sign boundary)', () => {
  const parts = allocate(money(0, 'GBP'), [1, 2, 3]);
  assert.deepEqual(parts.map((p) => p.amount), [0, 0, 0]);
  // sign * 0 is 0 either way, but Object.is distinguishes -0 from 0
  parts.forEach((p) => assert.ok(Object.is(p.amount, 0)));
});

test('allocate: large remainder distributes one unit each to top frac parts in order', () => {
  // total 1003, weights 1:1:1 -> exact 334.33.. floors 334/334/334 sum 1002, remainder 1 -> index 0
  const parts = allocate(money(1003, 'GBP'), [1, 1, 1]);
  assert.deepEqual(parts.map((p) => p.amount), [335, 334, 334]);
  assert.equal(parts.reduce((s, p) => s + p.amount, 0), 1003);
});

test('fromDecimal: rounds half-away-from-zero for negatives (kills rounding sign)', () => {
  // -2.345 * 100 = -234.5 -> half-away-from-zero -> -235
  assert.equal(fromDecimal(-2.345, 'GBP').amount, -235);
  // +2.345 -> +235 (symmetric)
  assert.equal(fromDecimal(2.345, 'GBP').amount, 235);
  // -2.344 -> -234 (rounds toward zero side)
  assert.equal(fromDecimal(-2.344, 'GBP').amount, -234);
});
