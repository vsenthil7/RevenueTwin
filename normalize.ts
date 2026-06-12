/**
 * Normalization layer (S14).
 *
 * Converts source-specific RawRecords into canonical model entities. Real source data is
 * messy — missing fields, string amounts, varied date formats — so every mapper validates
 * and rejects bad records explicitly rather than silently producing wrong domain objects.
 *
 * Money arrives from sources as decimal strings/numbers; we convert to integer minor units
 * via the money engine. The mapper NEVER guesses a missing amount.
 */
import { fromDecimal, money, type Money } from '../money/money.ts';
import type { RawRecord, ConnectorError as _CE } from './ingestion.ts';
import { ConnectorError } from './ingestion.ts';
import type {
  Customer, Contract, ContractTerm, Invoice, InvoiceLine, CommercialIntentEvent,
} from '../core/model.ts';

function reqString(r: RawRecord, key: string): string {
  const v = r.data[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ConnectorError(`${r.sourceId}:${r.externalId} missing string field '${key}'`);
  }
  return v;
}

function reqNumber(r: RawRecord, key: string): number {
  const v = r.data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  throw new ConnectorError(`${r.sourceId}:${r.externalId} missing numeric field '${key}'`);
}

function optNumber(r: RawRecord, key: string): number | undefined {
  const v = r.data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  throw new ConnectorError(`${r.sourceId}:${r.externalId} invalid numeric field '${key}'`);
}

/** Parse a source money value (decimal major units) into canonical minor-unit Money. */
export function normalizeMoney(r: RawRecord, key: string, currencyKey = 'currency'): Money {
  const amount = reqNumber(r, key);
  const currency = reqString(r, currencyKey);
  return fromDecimal(amount, currency);
}

/* ---------- Entity mappers ---------- */

export function toCustomer(r: RawRecord): Customer {
  return {
    id: reqString(r, 'id'),
    name: reqString(r, 'name'),
    arr: normalizeMoney(r, 'arr'),
    region: reqString(r, 'region'),
  };
}

export function toContract(r: RawRecord): Contract {
  return {
    id: reqString(r, 'id'),
    customerId: reqString(r, 'customerId'),
    startDate: reqString(r, 'startDate'),
    endDate: reqString(r, 'endDate'),
    machineReadable: r.data.machineReadable === true,
  };
}

export function toContractTerm(r: RawRecord): ContractTerm {
  const period = reqString(r, 'billingPeriod');
  if (period !== 'monthly' && period !== 'annual') {
    throw new ConnectorError(`${r.sourceId}:${r.externalId} invalid billingPeriod '${period}'`);
  }
  return {
    id: reqString(r, 'id'),
    contractId: reqString(r, 'contractId'),
    product: reqString(r, 'product'),
    unitPrice: normalizeMoney(r, 'unitPrice'),
    quantity: reqNumber(r, 'quantity'),
    billingPeriod: period,
    escalatorPercent: optNumber(r, 'escalatorPercent') ?? 0,
  };
}

export function toInvoice(r: RawRecord): Invoice {
  return {
    id: reqString(r, 'id'),
    customerId: reqString(r, 'customerId'),
    issueDate: reqString(r, 'issueDate'),
    currency: reqString(r, 'currency'),
  };
}

export function toInvoiceLine(r: RawRecord): InvoiceLine {
  return {
    id: reqString(r, 'id'),
    invoiceId: reqString(r, 'invoiceId'),
    product: reqString(r, 'product'),
    amount: normalizeMoney(r, 'amount'),
    quantity: reqNumber(r, 'quantity'),
  };
}

export function toCommercialIntentEvent(r: RawRecord): CommercialIntentEvent {
  const source = reqString(r, 'source');
  if (source !== 'email' && source !== 'meeting' && source !== 'qbr') {
    throw new ConnectorError(`${r.sourceId}:${r.externalId} invalid intent source '${source}'`);
  }
  const confidence = reqNumber(r, 'confidence');
  if (confidence < 0 || confidence > 1) {
    throw new ConnectorError(`${r.sourceId}:${r.externalId} confidence out of range`);
  }
  const uplift = optNumber(r, 'upliftPercent');
  return {
    id: reqString(r, 'id'),
    customerId: reqString(r, 'customerId'),
    source,
    capturedAt: reqString(r, 'capturedAt'),
    extractedSpan: reqString(r, 'extractedSpan'),
    intentType: reqString(r, 'intentType'),
    ...(uplift !== undefined ? { upliftPercent: uplift } : {}),
    confidence,
    deepLink: reqString(r, 'deepLink'),
  };
}

/** Dispatch a raw record to the right mapper by its `kind`. Unknown kinds are rejected. */
export type Normalized =
  | { kind: 'customer'; value: Customer }
  | { kind: 'contract'; value: Contract }
  | { kind: 'contractTerm'; value: ContractTerm }
  | { kind: 'invoice'; value: Invoice }
  | { kind: 'invoiceLine'; value: InvoiceLine }
  | { kind: 'intent'; value: CommercialIntentEvent };

export function normalize(r: RawRecord): Normalized {
  switch (r.kind) {
    case 'customer': return { kind: 'customer', value: toCustomer(r) };
    case 'contract': return { kind: 'contract', value: toContract(r) };
    case 'contractTerm': return { kind: 'contractTerm', value: toContractTerm(r) };
    case 'invoice': return { kind: 'invoice', value: toInvoice(r) };
    case 'invoiceLine': return { kind: 'invoiceLine', value: toInvoiceLine(r) };
    case 'intent': return { kind: 'intent', value: toCommercialIntentEvent(r) };
    default:
      throw new ConnectorError(`Unknown record kind '${r.kind}' from ${r.sourceId}`);
  }
}

/** Batch normalize, separating successes from rejects (data-quality exceptions). */
export interface NormalizeBatch {
  normalized: Normalized[];
  rejects: { record: RawRecord; reason: string }[];
}

/** Extract a human-readable reason from any thrown value (branchless for coverage). */
export function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : `${e}`;
}

export function normalizeBatch(records: RawRecord[]): NormalizeBatch {
  const normalized: Normalized[] = [];
  const rejects: { record: RawRecord; reason: string }[] = [];
  for (const r of records) {
    try {
      normalized.push(normalize(r));
    } catch (e) {
      rejects.push({ record: r, reason: reasonOf(e) });
    }
  }
  return { normalized, rejects };
}

void (0 as unknown as _CE); // keep type import meaningful
