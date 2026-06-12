/**
 * Journal entries (S42).
 *
 * Generates balanced double-entry GL postings for the financial events RevenueTwin produces:
 * revenue recognition, deferred revenue release, and leakage corrections. Every journal must
 * balance (sum of debits == sum of credits) — enforced and tested. Integer minor units.
 */
import { money, add, type Money } from '../money/money.ts';

export class JournalError extends Error {
  constructor(message: string) { super(message); this.name = 'JournalError'; }
}

export type Side = 'debit' | 'credit';

export interface JournalLine {
  readonly account: string;
  readonly side: Side;
  readonly amount: Money;
}

export interface JournalEntry {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly lines: JournalLine[];
}

/** Sum lines on a given side. */
function sumSide(lines: JournalLine[], side: Side, currency: string): Money {
  return lines.filter((l) => l.side === side).reduce<Money>((acc, l) => add(acc, l.amount), money(0, currency));
}

/** A journal balances iff total debits == total credits (same currency). */
export function isBalanced(entry: JournalEntry): boolean {
  if (entry.lines.length === 0) return false;
  const currency = entry.lines[0]!.amount.currency;
  for (const l of entry.lines) {
    if (l.amount.currency !== currency) throw new JournalError('Mixed currencies in a journal entry');
    if (l.amount.amount < 0) throw new JournalError('Journal line amounts must be >= 0');
  }
  return sumSide(entry.lines, 'debit', currency).amount === sumSide(entry.lines, 'credit', currency).amount;
}

/** Construct a journal entry and assert it balances. */
export function makeEntry(id: string, date: string, memo: string, lines: JournalLine[]): JournalEntry {
  const entry: JournalEntry = { id, date, memo, lines };
  if (!isBalanced(entry)) throw new JournalError(`Journal ${id} does not balance`);
  return entry;
}

/**
 * Revenue recognition entry: DR Deferred Revenue, CR Revenue for the recognized amount.
 * (Cash/AR is handled at invoice/collection time elsewhere.)
 */
export function recognitionEntry(id: string, date: string, amount: Money): JournalEntry {
  return makeEntry(id, date, 'Revenue recognition', [
    { account: 'Deferred Revenue', side: 'debit', amount },
    { account: 'Revenue', side: 'credit', amount },
  ]);
}

/**
 * Billing on invoice: DR Accounts Receivable, CR Deferred Revenue (revenue not yet earned).
 */
export function billingEntry(id: string, date: string, amount: Money): JournalEntry {
  return makeEntry(id, date, 'Invoice billed', [
    { account: 'Accounts Receivable', side: 'debit', amount },
    { account: 'Deferred Revenue', side: 'credit', amount },
  ]);
}

/**
 * Leakage correction (additional revenue recovered): DR Accounts Receivable, CR Revenue.
 */
export function correctionEntry(id: string, date: string, amount: Money): JournalEntry {
  return makeEntry(id, date, 'Leakage correction', [
    { account: 'Accounts Receivable', side: 'debit', amount },
    { account: 'Revenue', side: 'credit', amount },
  ]);
}

/**
 * Credit-note reversal (concession on a disputed correction): DR Revenue, CR Accounts Receivable.
 */
export function creditNoteEntry(id: string, date: string, amount: Money): JournalEntry {
  return makeEntry(id, date, 'Credit note', [
    { account: 'Revenue', side: 'debit', amount },
    { account: 'Accounts Receivable', side: 'credit', amount },
  ]);
}

/** Per-account net movement across many entries (debits positive, credits negative). */
export interface AccountMovement { account: string; netMinor: number; }

export function accountMovements(entries: JournalEntry[]): AccountMovement[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    for (const l of e.lines) {
      const delta = l.side === 'debit' ? l.amount.amount : -l.amount.amount;
      map.set(l.account, (map.get(l.account) ?? 0) + delta);
    }
  }
  return [...map.entries()].map(([account, netMinor]) => ({ account, netMinor }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/** A batch balances iff every entry balances AND aggregate debits == aggregate credits. */
export function batchBalances(entries: JournalEntry[]): boolean {
  return entries.every(isBalanced);
}
