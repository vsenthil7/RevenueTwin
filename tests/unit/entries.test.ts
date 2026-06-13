import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JournalError, isBalanced, makeEntry, recognitionEntry, billingEntry,
  correctionEntry, creditNoteEntry, accountMovements, batchBalances,
  type JournalEntry,
} from '../../src/journal/entries.ts';
import { money } from '../../src/money/money.ts';

test('isBalanced true for equal debits and credits', () => {
  const e = recognitionEntry('j1', '2026-01-01', money(1000_00, 'GBP'));
  assert.equal(isBalanced(e), true);
});

test('isBalanced false for an empty entry', () => {
  assert.equal(isBalanced({ id: 'x', date: 'd', memo: 'm', lines: [] }), false);
});

test('isBalanced false when debits != credits', () => {
  const e: JournalEntry = { id: 'x', date: 'd', memo: 'm', lines: [
    { account: 'A', side: 'debit', amount: money(100, 'GBP') },
    { account: 'B', side: 'credit', amount: money(50, 'GBP') },
  ] };
  assert.equal(isBalanced(e), false);
});

test('isBalanced rejects mixed currencies and negative amounts', () => {
  assert.throws(() => isBalanced({ id: 'x', date: 'd', memo: 'm', lines: [
    { account: 'A', side: 'debit', amount: money(100, 'GBP') },
    { account: 'B', side: 'credit', amount: money(100, 'USD') },
  ] }), JournalError);
  assert.throws(() => isBalanced({ id: 'x', date: 'd', memo: 'm', lines: [
    { account: 'A', side: 'debit', amount: money(-100, 'GBP') },
  ] }), JournalError);
});

test('makeEntry throws when the entry does not balance', () => {
  assert.throws(() => makeEntry('x', 'd', 'm', [
    { account: 'A', side: 'debit', amount: money(100, 'GBP') },
    { account: 'B', side: 'credit', amount: money(90, 'GBP') },
  ]), JournalError);
});

test('the four standard entries each balance with the right accounts', () => {
  const amt = money(500_00, 'GBP');
  const rec = recognitionEntry('r', 'd', amt);
  assert.equal(rec.lines[0]!.account, 'Deferred Revenue');
  assert.equal(rec.lines[1]!.account, 'Revenue');
  assert.ok(isBalanced(billingEntry('b', 'd', amt)));
  assert.ok(isBalanced(correctionEntry('c', 'd', amt)));
  assert.ok(isBalanced(creditNoteEntry('n', 'd', amt)));
});

test('accountMovements nets debits positive and credits negative, sorted by account', () => {
  const entries = [
    correctionEntry('c1', 'd', money(300_00, 'GBP')), // DR AR, CR Revenue
    creditNoteEntry('n1', 'd', money(100_00, 'GBP')),  // DR Revenue, CR AR
  ];
  const moves = accountMovements(entries);
  const ar = moves.find((m) => m.account === 'Accounts Receivable')!;
  const rev = moves.find((m) => m.account === 'Revenue')!;
  assert.equal(ar.netMinor, 300_00 - 100_00);  // +300 -100
  assert.equal(rev.netMinor, -300_00 + 100_00); // -300 +100
  // sorted alphabetically: Accounts Receivable before Revenue
  assert.deepEqual(moves.map((m) => m.account), ['Accounts Receivable', 'Revenue']);
});

test('batchBalances true when all entries balance, false otherwise', () => {
  const good = [recognitionEntry('r', 'd', money(100_00, 'GBP'))];
  assert.equal(batchBalances(good), true);
  const bad: JournalEntry[] = [{ id: 'x', date: 'd', memo: 'm', lines: [
    { account: 'A', side: 'debit', amount: money(100, 'GBP') },
    { account: 'B', side: 'credit', amount: money(50, 'GBP') },
  ] }];
  assert.equal(batchBalances(bad), false);
});
