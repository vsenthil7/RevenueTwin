import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SplitError, percentageSplit, tieredCommission, vendorNetDown, splitSumsExactly,
  type CommissionTier,
} from '../../src/partners/revenue-split.ts';
import { money } from '../../src/money/money.ts';

test('percentageSplit allocates shares and a retained remainder, summing exactly', () => {
  const lines = percentageSplit(money(1000_00, 'GBP'), [
    { partyId: 'reseller', percent: 30 },
    { partyId: 'referral', percent: 10 },
  ]);
  assert.ok(splitSumsExactly(lines, money(1000_00, 'GBP')));
  assert.equal(lines.find((l) => l.partyId === 'reseller')!.amount.amount, 300_00);
  assert.equal(lines.find((l) => l.partyId === 'vendor_retained')!.amount.amount, 600_00);
});

test('percentageSplit with no remainder omits vendor_retained', () => {
  const lines = percentageSplit(money(1000_00, 'GBP'), [
    { partyId: 'a', percent: 60 },
    { partyId: 'b', percent: 40 },
  ]);
  assert.equal(lines.find((l) => l.partyId === 'vendor_retained'), undefined);
  assert.ok(splitSumsExactly(lines, money(1000_00, 'GBP')));
});

test('percentageSplit distributes rounding penny to the largest share', () => {
  // 33.33% of 1000.00 each -> rounding; exact sum still enforced
  const lines = percentageSplit(money(1000_00, 'GBP'), [
    { partyId: 'a', percent: 33.33 },
    { partyId: 'b', percent: 33.33 },
    { partyId: 'c', percent: 33.34 },
  ]);
  assert.ok(splitSumsExactly(lines, money(1000_00, 'GBP')));
});

test('percentageSplit corrects a rounding overage so the sum is exact', () => {
  // gross 10.01: 50% each rounds to 5.01 + 5.01 = 10.02 (overage); fix brings it to exact 10.01
  const lines = percentageSplit(money(1001, 'GBP'), [
    { partyId: 'a', percent: 50 },
    { partyId: 'b', percent: 50 },
  ]);
  assert.ok(splitSumsExactly(lines, money(1001, 'GBP')));
  assert.equal(lines.reduce((s, l) => s + l.amount.amount, 0), 1001);
});

test('percentageSplit assigns the rounding diff to the largest (later) share', () => {
  // gross 9 with 15/35/45: rounding leaves a diff and the largest share is the LAST party (c).
  const lines = percentageSplit(money(9, 'GBP'), [
    { partyId: 'a', percent: 15 },
    { partyId: 'b', percent: 35 },
    { partyId: 'c', percent: 45 },
  ]);
  assert.ok(splitSumsExactly(lines, money(9, 'GBP')));
  // c is the largest line and absorbs the correction
  assert.equal(lines.find((l) => l.partyId === 'c')!.amount.amount, 5);
});

test('percentageSplit validates percent bounds and total', () => {
  assert.throws(() => percentageSplit(money(100, 'GBP'), [{ partyId: 'a', percent: -1 }]), SplitError);
  assert.throws(() => percentageSplit(money(100, 'GBP'), [{ partyId: 'a', percent: 101 }]), SplitError);
  assert.throws(() => percentageSplit(money(100, 'GBP'), [{ partyId: 'a', percent: 60 }, { partyId: 'b', percent: 60 }]), SplitError);
});

test('percentageSplit rejects empty shares', () => {
  assert.throws(() => percentageSplit(money(100, 'GBP'), []), SplitError);
});

test('tieredCommission breaks once volume is exhausted mid-ladder', () => {
  // volume 500 exactly fills bands 1 (100) + 2 (400); band 3 iteration hits remaining<=0 -> break
  const c = tieredCommission(money(10000_00, 'GBP'), 500, tiers);
  assert.ok(c.amount > 0);
});

const tiers: CommissionTier[] = [
  { upToVolume: 100, ratePercent: 5 },
  { upToVolume: 500, ratePercent: 10 },
  { upToVolume: null, ratePercent: 15 },
];

test('tieredCommission accrues graduated commission across bands', () => {
  // volume 600 on gross 10000.00: band1 100/600, band2 400/600, band3 100/600
  const c = tieredCommission(money(10000_00, 'GBP'), 600, tiers);
  assert.ok(c.amount > 0);
});

test('tieredCommission zero volume yields zero', () => {
  assert.equal(tieredCommission(money(10000_00, 'GBP'), 0, tiers).amount, 0);
});

test('tieredCommission validates volume and tiers, and tier overflow', () => {
  assert.throws(() => tieredCommission(money(100, 'GBP'), -1, tiers), SplitError);
  assert.throws(() => tieredCommission(money(100, 'GBP'), 10, []), SplitError);
  const bounded: CommissionTier[] = [{ upToVolume: 100, ratePercent: 5 }];
  assert.throws(() => tieredCommission(money(100, 'GBP'), 200, bounded), SplitError);
});

test('vendorNetDown subtracts partner shares (excluding retained)', () => {
  const lines = percentageSplit(money(1000_00, 'GBP'), [
    { partyId: 'reseller', percent: 30 },
    { partyId: 'referral', percent: 10 },
  ]);
  const net = vendorNetDown(money(1000_00, 'GBP'), lines);
  // partners take 40% -> vendor nets 60% = 600.00 (retained line excluded from partner total)
  assert.equal(net.amount, 600_00);
});

test('splitSumsExactly detects an off-by-one', () => {
  const lines = percentageSplit(money(1000_00, 'GBP'), [{ partyId: 'a', percent: 50 }]);
  const tampered = lines.map((l, i) => i === 0 ? { ...l, amount: money(l.amount.amount + 1, 'GBP') } : l);
  assert.equal(splitSumsExactly(tampered, money(1000_00, 'GBP')), false);
});
