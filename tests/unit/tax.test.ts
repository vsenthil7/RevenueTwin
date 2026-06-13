import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TaxError, assessTax, effectiveRate, JurisdictionRegistry, taxLeakage,
  type TaxComponent,
} from '../../src/tax/jurisdiction.ts';
import { money } from '../../src/money/money.ts';

const vat: TaxComponent = { jurisdiction: 'GB', name: 'VAT', ratePercent: 20, compound: false };
const state: TaxComponent = { jurisdiction: 'US-CA', name: 'State', ratePercent: 6, compound: false };
const city: TaxComponent = { jurisdiction: 'US-CA-SF', name: 'City', ratePercent: 1, compound: true };

test('assessTax applies a single non-compound rate', () => {
  const a = assessTax(money(100_00, 'GBP'), [vat]);
  assert.equal(a.totalTax.amount, 20_00);
  assert.equal(a.gross.amount, 120_00);
  assert.equal(a.exempt, false);
  assert.equal(a.lines.length, 1);
});

test('assessTax handles compound tax-on-tax', () => {
  // base 100.00: state 6% = 6.00 (on base); city 1% compound = 1% of (100 + 6) = 1.06
  const a = assessTax(money(100_00, 'GBP'), [state, city]);
  assert.equal(a.lines[0]!.tax.amount, 6_00);
  assert.equal(a.lines[1]!.taxable.amount, 106_00);
  assert.equal(a.lines[1]!.tax.amount, 106);
  assert.equal(a.totalTax.amount, 6_00 + 106);
});

test('assessTax exemption yields zero tax', () => {
  const a = assessTax(money(100_00, 'GBP'), [vat], true);
  assert.equal(a.totalTax.amount, 0);
  assert.equal(a.gross.amount, 100_00);
  assert.equal(a.exempt, true);
  assert.equal(a.lines.length, 0);
});

test('assessTax rejects negative base and negative rate', () => {
  assert.throws(() => assessTax(money(-1, 'GBP'), [vat]), TaxError);
  assert.throws(() => assessTax(money(100_00, 'GBP'), [{ ...vat, ratePercent: -5 }]), TaxError);
});

test('effectiveRate computes total/base percent; zero base -> 0', () => {
  const a = assessTax(money(100_00, 'GBP'), [vat]);
  assert.equal(effectiveRate(a), 20);
  const zero = assessTax(money(0, 'GBP'), [vat]);
  assert.equal(effectiveRate(zero), 0);
});

test('JurisdictionRegistry resolves region-exact then country-level, else throws', () => {
  const reg = new JurisdictionRegistry();
  reg.register({ country: 'GB', components: [vat] });
  reg.register({ country: 'US', region: 'CA', components: [state, city] });
  assert.deepEqual(reg.resolve('GB'), [vat]);
  assert.deepEqual(reg.resolve('US', 'CA'), [state, city]);
  // region given but no exact match -> falls back to country-level if present
  reg.register({ country: 'US', components: [state] });
  assert.deepEqual(reg.resolve('US', 'NV'), [state]);
  assert.throws(() => reg.resolve('FR'), TaxError);
  assert.throws(() => reg.resolve('FR', 'IDF'), TaxError);
});

test('JurisdictionRegistry.assess resolves then assesses', () => {
  const reg = new JurisdictionRegistry();
  reg.register({ country: 'GB', components: [vat] });
  const a = reg.assess(money(100_00, 'GBP'), 'GB');
  assert.equal(a.totalTax.amount, 20_00);
  // exempt path through assess
  assert.equal(reg.assess(money(100_00, 'GBP'), 'GB', undefined, true).totalTax.amount, 0);
});

test('taxLeakage surfaces under-charged tax, floors at zero', () => {
  const expected = assessTax(money(100_00, 'GBP'), [vat]); // 20.00 expected
  assert.equal(taxLeakage(expected, money(15_00, 'GBP')).amount, 5_00);
  assert.equal(taxLeakage(expected, money(20_00, 'GBP')).amount, 0);
  assert.equal(taxLeakage(expected, money(25_00, 'GBP')).amount, 0); // over-charged -> 0
});
