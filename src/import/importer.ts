/**
 * CSV import: turns a buyer billing data (expected vs actual per line) into real leakage
 * findings and cases, using the SAME deterministic reconciliation engine as the rest of the
 * product. This is what lets a CFO see THEIR recoverable revenue instead of the seeded demo.
 * The importer only maps + validates; every money figure comes from buildFinding, never invented.
 */
import type { LeakageType, LeakageCase, VarianceFinding } from '../core/model.ts';
import { buildFinding, createCase, caseNetRecoverable, type VarianceInput } from '../core/reconciliation.ts';
import { fromDecimal, sum, format, type Money, type CurrencyCode } from '../money/money.ts';
import { parseCsvRecords } from './csv.ts';

export class ImportError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportError'; }
}

const LEAKAGE_TYPES: ReadonlySet<string> = new Set<LeakageType>([
  'contract', 'invoice', 'customer', 'intent', 'price_changed', 'quantity_changed',
  'escalator_changed', 'usage_overage', 'tax', 'recognition', 'missed_escalator',
  'expired_discount', 'unbilled_usage', 'dunning_gap', 'pricing_config',
]);

export const REQUIRED_COLUMNS = ['customer', 'line_id', 'type', 'expected', 'actual', 'currency'] as const;

export interface ImportRowReject { readonly row: number; readonly reason: string; }

export interface ImportedCaseSummary {
  readonly caseId: string;
  readonly customerId: string;
  readonly findingCount: number;
  readonly netRecoverable: Money;
  readonly netRecoverableFormatted: string;
}

export interface ImportResult {
  readonly cases: LeakageCase[];
  readonly summaries: ImportedCaseSummary[];
  readonly totalRecoverable: Money;
  readonly totalRecoverableFormatted: string;
  readonly rowsAccepted: number;
  readonly rowsRejected: number;
  readonly rejects: ImportRowReject[];
  readonly currency: CurrencyCode;
}

export interface ImportOptions { readonly now?: () => string; }

function reqNumber(rec: Record<string, string>, key: string, rowNo: number): number {
  const raw = rec[key];
  if (raw === undefined || raw === '') throw new ImportError('row ' + rowNo + ': missing ' + key);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ImportError('row ' + rowNo + ': ' + key + ' not a number (' + raw + ')');
  return n;
}

function optNumber(rec: Record<string, string>, key: string): number | undefined {
  const raw = rec[key];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ImportError(key + ' not a number: ' + raw);
  return n;
}

/** Map one CSV record into a VarianceInput. Throws ImportError with a row-scoped message. */
export function rowToVarianceInput(rec: Record<string, string>, rowNo: number, currency: CurrencyCode): VarianceInput {
  const type = rec['type'];
  if (type === undefined || !LEAKAGE_TYPES.has(type)) throw new ImportError('row ' + rowNo + ': invalid type ' + String(type));
  const expectedMajor = reqNumber(rec, 'expected', rowNo);
  const actualMajor = reqNumber(rec, 'actual', rowNo);
  const lineId = rec['line_id'];
  if (lineId === undefined || lineId === '') throw new ImportError('row ' + rowNo + ': missing line_id');
  const confidence = optNumber(rec, 'confidence') ?? 0.9;
  const ageDays = optNumber(rec, 'age_days') ?? 30;
  const contractStrength = optNumber(rec, 'contract_strength');
  return {
    id: lineId,
    type: type as LeakageType,
    expected: fromDecimal(expectedMajor, currency),
    actual: fromDecimal(actualMajor, currency),
    confidence,
    ageDays,
    ...(contractStrength !== undefined ? { contractStrength } : {}),
    ...(rec['field'] ? { field: rec['field'] } : {}),
    ...(rec['name'] ? { name: rec['name'] } : {}),
  };
}

/**
 * Import a CSV of expected-vs-actual billing lines into real leakage cases (one per customer).
 * Sub-materiality / time-barred rows are accepted but yield no finding; malformed rows become
 * rejects rather than being silently dropped. One currency per import.
 */
export function importCsv(text: string, opts: ImportOptions = {}): ImportResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const records = parseCsvRecords(text);
  if (records.length === 0) throw new ImportError('CSV has no data rows');
  const have = new Set(Object.keys(records[0]!));
  for (const col of REQUIRED_COLUMNS) {
    if (!have.has(col)) throw new ImportError('CSV missing required column: ' + col);
  }
  let currency: CurrencyCode | null = null;
  const rejects: ImportRowReject[] = [];
  const byCustomer = new Map<string, VarianceFinding[]>();
  let accepted = 0;
  for (let r = 0; r < records.length; r++) {
    const rec = records[r]!;
    const rowNo = r + 2;
    const cust = rec['customer'];
    const cur = rec['currency'] as CurrencyCode;
    try {
      if (!cust) throw new ImportError('row ' + rowNo + ': missing customer');
      if (!cur) throw new ImportError('row ' + rowNo + ': missing currency');
      if (currency === null) currency = cur;
      else if (cur !== currency) throw new ImportError('row ' + rowNo + ': mixed currencies; import one at a time');
      const vi = rowToVarianceInput(rec, rowNo, cur);
      const finding = buildFinding(vi);
      accepted += 1;
      if (finding !== null) {
        const list = byCustomer.get(cust) ?? [];
        list.push(finding);
        byCustomer.set(cust, list);
      }
    } catch (e) {
      // Everything thrown inside the loop is an ImportError (an Error); no non-Error path exists.
      rejects.push({ row: rowNo, reason: (e as Error).message });
    }
  }
  const cur2: CurrencyCode = currency ?? 'GBP';
  const cases: LeakageCase[] = [];
  const summaries: ImportedCaseSummary[] = [];
  let caseSeq = 0;
  for (const [customerId, findings] of byCustomer) {
    const c = createCase('imported-' + customerId + '-' + caseSeq, customerId, findings, now());
    caseSeq += 1;
    const net = caseNetRecoverable(c);
    cases.push(c);
    summaries.push({ caseId: c.id, customerId, findingCount: findings.length, netRecoverable: net, netRecoverableFormatted: format(net) });
  }
  summaries.sort((x, y) => y.netRecoverable.amount - x.netRecoverable.amount);
  const total = summaries.length > 0 ? sum(summaries.map((s) => s.netRecoverable), cur2) : { amount: 0, currency: cur2 };
  return { cases, summaries, totalRecoverable: total, totalRecoverableFormatted: format(total), rowsAccepted: accepted, rowsRejected: rejects.length, rejects, currency: cur2 };
}
