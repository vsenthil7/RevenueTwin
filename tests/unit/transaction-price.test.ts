import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AllocationError, allocateBySSP, allocationSumsExactly, allocateResidual, allocateDiscount,
  type AllocItem,
} from '../../src/allocation/transaction-price.ts';
import { money } from '../../src/money/money.ts';

const items: AllocItem[] = [
  { id: 'a', ssp: money(600_00, 'GBP') },
  { id: 'b', ssp: money(300_00, 'GBP') },
  { id: 'c', ssp: money(100_00, 'GBP') },
];

test('allocateBySSP distributes proportionally and sums exactly', () => {
  const allocs = allocateBySSP(items, money(1000_00, 'GBP'));
  assert.ok(allocationSumsExactly(allocs, money(1000_00, 'GBP')));
  assert.equal(allocs.find((a) => a.id === 'a')!.allocated.amount, 600_00);
});

test('allocateBySSP absorbs rounding remainder exactly', () => {
  // price 100 across three equal SSPs -> 34/33/33 (or distributed) summing to 100
  const eq: AllocItem[] = [
    { id: 'a', ssp: money(100, 'GBP') },
    { id: 'b', ssp: money(100, 'GBP') },
    { id: 'c', ssp: money(100, 'GBP') },
  ];
  const allocs = allocateBySSP(eq, money(100, 'GBP'));
  assert.equal(allocs.reduce((s, a) => s + a.allocated.amount, 0), 100);
});

test('allocateBySSP rejects empty items and non-positive SSP total', () => {
  assert.throws(() => allocateBySSP([], money(100, 'GBP')), AllocationError);
  assert.throws(() => allocateBySSP([{ id: 'a', ssp: money(0, 'GBP') }], money(100, 'GBP')), AllocationError);
});

test('allocateBySSP rejects mismatched currencies', () => {
  assert.throws(() => allocateBySSP([{ id: 'a', ssp: money(100, 'USD') }], money(100, 'GBP')), AllocationError);
});

test('allocationSumsExactly detects an off-by-one', () => {
  const allocs = allocateBySSP(items, money(1000_00, 'GBP'));
  const tampered = [...allocs.slice(1), { ...allocs[0]!, allocated: money(allocs[0]!.allocated.amount + 1, 'GBP') }];
  assert.equal(allocationSumsExactly(tampered, money(1000_00, 'GBP')), false);
});

test('allocateResidual gives the unobserved obligation the leftover', () => {
  const allocs = allocateResidual([{ id: 'a', ssp: money(600_00, 'GBP') }], 'resid', money(1000_00, 'GBP'));
  assert.equal(allocs.find((a) => a.id === 'resid')!.allocated.amount, 400_00);
  assert.equal(allocs.find((a) => a.id === 'a')!.allocated.amount, 600_00);
});

test('allocateResidual rejects a negative residual', () => {
  assert.throws(() => allocateResidual([{ id: 'a', ssp: money(1200_00, 'GBP') }], 'resid', money(1000_00, 'GBP')), AllocationError);
});

test('allocateDiscount spreads a bundle discount by SSP', () => {
  const allocs = allocateDiscount(items, money(100_00, 'GBP')); // net price 900.00
  assert.equal(allocs.reduce((s, a) => s + a.allocated.amount, 0), 900_00);
});

test('allocateDiscount validates discount bounds and SSP total', () => {
  assert.throws(() => allocateDiscount([{ id: 'a', ssp: money(0, 'GBP') }], money(0, 'GBP')), AllocationError);
  assert.throws(() => allocateDiscount(items, money(-1, 'GBP')), AllocationError);
  assert.throws(() => allocateDiscount(items, money(2000_00, 'GBP')), AllocationError); // exceeds total SSP
});
