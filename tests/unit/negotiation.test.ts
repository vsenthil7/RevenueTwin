import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DisputeError, DISPUTE_TRANSITIONS, canTransitionDispute, openDispute, transitionDispute,
  recordOffer, latestOffer, negotiationGap, settle, disputeAgeDays, disputePortfolio,
  type Dispute, type Offer, type DisputeStatus,
} from '../../src/disputes/negotiation.ts';
import { money } from '../../src/money/money.ts';

function dispute(): Dispute {
  return openDispute('d1', 'case1', 'acme', money(1000_00, 'GBP'), '2026-01-01T00:00:00Z');
}
function offer(party: 'us' | 'customer', amount: number, at = '2026-01-02'): Offer {
  return { party, amount: money(amount, 'GBP'), at, note: `${party} offer` };
}

test('openDispute requires a positive claim', () => {
  assert.equal(dispute().status, 'open');
  assert.throws(() => openDispute('d', 'c', 'x', money(0, 'GBP'), 'a'), DisputeError);
});

test('canTransitionDispute reflects the table; terminal states have none', () => {
  assert.equal(canTransitionDispute('open', 'negotiating'), true);
  assert.equal(canTransitionDispute('open', 'settled'), false);
  for (const s of ['settled', 'withdrawn'] as DisputeStatus[]) {
    assert.deepEqual(DISPUTE_TRANSITIONS[s], []);
  }
});

test('transitionDispute advances legally and rejects illegal', () => {
  const d = dispute();
  transitionDispute(d, 'negotiating');
  assert.equal(d.status, 'negotiating');
  assert.throws(() => transitionDispute(d, 'open'), DisputeError);
});

test('recordOffer moves open->negotiating and appends; validates bounds and status', () => {
  const d = dispute();
  recordOffer(d, offer('us', 900_00));
  assert.equal(d.status, 'negotiating');
  assert.equal(d.offers.length, 1);
  // out of range
  assert.throws(() => recordOffer(d, offer('customer', 2000_00)), DisputeError);
  assert.throws(() => recordOffer(d, offer('customer', -1)), DisputeError);
  // wrong status
  transitionDispute(d, 'settled' as DisputeStatus); // negotiating->settled is legal
  assert.throws(() => recordOffer(d, offer('us', 100_00)), DisputeError);
});

test('latestOffer returns the most recent per party or null', () => {
  const d = dispute();
  assert.equal(latestOffer(d, 'us'), null);
  recordOffer(d, offer('us', 900_00, 't1'));
  recordOffer(d, offer('customer', 500_00, 't2'));
  recordOffer(d, offer('us', 800_00, 't3'));
  assert.equal(latestOffer(d, 'us')!.amount.amount, 800_00);
  assert.equal(latestOffer(d, 'customer')!.amount.amount, 500_00);
});

test('negotiationGap = our ask - their offer, floored at zero, zero if missing', () => {
  const d = dispute();
  assert.equal(negotiationGap(d).amount, 0); // none yet
  recordOffer(d, offer('us', 800_00));
  recordOffer(d, offer('customer', 500_00));
  assert.equal(negotiationGap(d).amount, 300_00);
  // customer offers more than our ask -> floored 0
  recordOffer(d, offer('customer', 900_00));
  assert.equal(negotiationGap(d).amount, 0);
});

test('settle computes recovered/conceded split and recovery rate', () => {
  const d = dispute();
  recordOffer(d, offer('us', 900_00));
  const s = settle(d, money(750_00, 'GBP'), '2026-02-01');
  assert.equal(s.recovered.amount, 750_00);
  assert.equal(s.conceded.amount, 250_00);
  assert.equal(s.recoveryRatePct, 75);
  assert.equal(d.status, 'settled');
});

test('settle rejects double-settle, illegal status, and out-of-range amount', () => {
  const d = dispute();
  recordOffer(d, offer('us', 900_00));
  settle(d, money(750_00, 'GBP'), '2026-02-01');
  assert.throws(() => settle(d, money(700_00, 'GBP'), '2026-02-02'), DisputeError); // already settled
  const d2 = dispute();
  transitionDispute(d2, 'withdrawn');
  assert.throws(() => settle(d2, money(100_00, 'GBP'), 'a'), DisputeError); // can't settle from withdrawn
  const d3 = dispute();
  recordOffer(d3, offer('us', 900_00));
  assert.throws(() => settle(d3, money(2000_00, 'GBP'), 'a'), DisputeError); // exceeds claim
});

test('disputeAgeDays uses resolvedAt when set, else now; rejects bad dates', () => {
  const d = dispute();
  assert.equal(disputeAgeDays(d, '2026-01-11T00:00:00Z'), 10);
  recordOffer(d, offer('us', 900_00));
  settle(d, money(900_00, 'GBP'), '2026-01-06T00:00:00Z');
  assert.equal(disputeAgeDays(d, '2026-02-01T00:00:00Z'), 5); // uses resolvedAt
  assert.throws(() => disputeAgeDays(dispute(), 'bad-date'), DisputeError);
});

test('disputePortfolio aggregates settled and open counts', () => {
  const settled = dispute();
  recordOffer(settled, offer('us', 900_00));
  settle(settled, money(800_00, 'GBP'), '2026-02-01');
  const open = dispute();
  recordOffer(open, offer('us', 500_00)); // negotiating
  const withdrawn = dispute();
  transitionDispute(withdrawn, 'withdrawn');
  const p = disputePortfolio([settled, open, withdrawn], 'GBP');
  assert.equal(p.recovered.amount, 800_00);
  assert.equal(p.conceded.amount, 200_00);
  assert.equal(p.settledCount, 1);
  assert.equal(p.openCount, 1); // withdrawn counts neither
});
