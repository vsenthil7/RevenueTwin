/**
 * CSV column mapping (S66).
 *
 * A real CFO export will not use our canonical column names. This module lets the caller map
 * THEIR headers onto ours, auto-suggests a mapping from common aliases, and emits a downloadable
 * template. It is pure and deterministic; the importer applies the mapping before its column
 * checks, so the engine and all downstream logic are unchanged.
 */
'use strict';

/** Canonical required columns (kept in sync with importer.REQUIRED_COLUMNS; duplicated here to
 * avoid a runtime import cycle, since the importer imports applyMapping from this module). */
export const REQUIRED_COLUMNS = ['customer', 'line_id', 'type', 'expected', 'actual', 'currency'] as const;

/** Canonical optional columns the engine understands beyond the required set. */
export const OPTIONAL_COLUMNS = ['confidence', 'age_days', 'contract_strength', 'field', 'name'] as const;

export const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;

/** Mapping from a source header (as it appears in the buyer file) to a canonical column name. */
export type ColumnMapping = Record<string, string>;

export class MappingError extends Error {
  constructor(message: string) { super(message); this.name = 'MappingError'; }
}

/** Common header aliases -> canonical column. Lowercased, non-alphanumeric stripped, for matching. */
const ALIASES: Record<string, string> = {
  customer: 'customer', customername: 'customer', account: 'customer', accountname: 'customer', client: 'customer', clientname: 'customer',
  lineid: 'line_id', line: 'line_id', invoiceid: 'line_id', invoicenumber: 'line_id', invoiceno: 'line_id', reference: 'line_id', ref: 'line_id',
  type: 'type', leakagetype: 'type', category: 'type', issuetype: 'type',
  expected: 'expected', expectedamount: 'expected', contractamount: 'expected', shouldbe: 'expected', entitled: 'expected', entitledamount: 'expected',
  actual: 'actual', actualamount: 'actual', invoiceamount: 'actual', billed: 'actual', billedamount: 'actual', invoiced: 'actual',
  currency: 'currency', ccy: 'currency', currencycode: 'currency',
  confidence: 'confidence', conf: 'confidence',
  agedays: 'age_days', age: 'age_days', daysoutstanding: 'age_days', dayssinceinvoice: 'age_days',
  contractstrength: 'contract_strength', strength: 'contract_strength',
  field: 'field',
  name: 'name', description: 'name', note: 'name', notes: 'name',
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().split('').filter((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')).join('');
}

/** Suggest a header -> canonical mapping from a list of source headers, using the alias table. */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const out: ColumnMapping = {};
  for (const h of headers) {
    const canonical = ALIASES[normalizeHeader(h)];
    if (canonical !== undefined) out[h] = canonical;
  }
  return out;
}

/**
 * Apply a column mapping to parsed records: rename each mapped source key to its canonical name.
 * Unmapped keys are dropped. Throws MappingError if two source headers map to the same canonical
 * column (an ambiguous mapping the caller must resolve).
 */
export function applyMapping(
  records: readonly Record<string, string>[],
  mapping: ColumnMapping,
): Record<string, string>[] {
  const targets = Object.values(mapping);
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t)) throw new MappingError('Two columns map to the same target: ' + t);
    seen.add(t);
  }
  return records.map((rec) => {
    const out: Record<string, string> = {};
    for (const [src, canonical] of Object.entries(mapping)) {
      const v = rec[src];
      if (v !== undefined) out[canonical] = v;
    }
    return out;
  });
}

/** A downloadable canonical template: header row + one worked example row. */
export function csvTemplate(): string {
  const header = ALL_COLUMNS.join(',');
  const example = ['Acme Corp', 'INV-1001', 'price_changed', '12000', '10800', 'GBP', '0.95', '45', '', '', 'Q1 enterprise license'].join(',');
  return header + '\n' + example + '\n';
}
