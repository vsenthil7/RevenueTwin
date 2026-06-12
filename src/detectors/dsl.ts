/**
 * Custom leakage-detector DSL (S40).
 *
 * Lets customers define their own leakage detectors declaratively WITHOUT executing arbitrary
 * code (no eval, no injection surface). Rules are a small typed AST of conditions over a flat
 * record of fields; the evaluator is deterministic and total. This is the safe extension point
 * for "we have a leakage pattern your built-ins don't cover yet".
 */
export class DetectorError extends Error {
  constructor(message: string) { super(message); this.name = 'DetectorError'; }
}

export type FieldValue = number | string | boolean;
export type RecordShape = Record<string, FieldValue>;

export type Comparator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';

export type Condition =
  | { kind: 'compare'; field: string; op: Comparator; value: FieldValue }
  | { kind: 'and'; clauses: Condition[] }
  | { kind: 'or'; clauses: Condition[] }
  | { kind: 'not'; clause: Condition };

export interface DetectorRule {
  readonly id: string;
  readonly description: string;
  readonly when: Condition;
  /** field holding the recoverable amount (minor units) when the rule matches. */
  readonly amountField: string;
}

function compareValues(a: FieldValue, op: Comparator, b: FieldValue): boolean {
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new DetectorError(`Operator '${op}' requires numbers`);
      }
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
  }
}

/** Evaluate a condition against a record. Total and deterministic; unknown fields are an error. */
export function evaluateCondition(cond: Condition, record: RecordShape): boolean {
  switch (cond.kind) {
    case 'compare': {
      if (!(cond.field in record)) throw new DetectorError(`Unknown field '${cond.field}'`);
      return compareValues(record[cond.field]!, cond.op, cond.value);
    }
    case 'and': return cond.clauses.every((c) => evaluateCondition(c, record));
    case 'or': return cond.clauses.some((c) => evaluateCondition(c, record));
    case 'not': return !evaluateCondition(cond.clause, record);
  }
}

export interface DetectorHit {
  readonly ruleId: string;
  readonly recordIndex: number;
  readonly amountMinor: number;
}

/** Run a single rule over a set of records, returning hits with the recoverable amount. */
export function runDetector(rule: DetectorRule, records: RecordShape[]): DetectorHit[] {
  const hits: DetectorHit[] = [];
  records.forEach((record, i) => {
    if (evaluateCondition(rule.when, record)) {
      const amt = record[rule.amountField];
      if (typeof amt !== 'number' || !Number.isInteger(amt)) {
        throw new DetectorError(`amountField '${rule.amountField}' must be an integer on matched record`);
      }
      hits.push({ ruleId: rule.id, recordIndex: i, amountMinor: amt });
    }
  });
  return hits;
}

/** Run many rules; returns all hits across rules. */
export function runDetectorSuite(rules: DetectorRule[], records: RecordShape[]): DetectorHit[] {
  const ids = new Set<string>();
  for (const r of rules) {
    if (ids.has(r.id)) throw new DetectorError(`Duplicate detector id '${r.id}'`);
    ids.add(r.id);
  }
  return rules.flatMap((r) => runDetector(r, records));
}

/** Total recoverable (minor units) flagged by a set of hits. */
export function totalFlagged(hits: DetectorHit[]): number {
  return hits.reduce((s, h) => s + h.amountMinor, 0);
}

/**
 * Validate a rule's AST shape and referenced fields against a known schema before activation, so
 * a malformed customer rule fails at registration, not at runtime over production data.
 */
export function validateRule(rule: DetectorRule, knownFields: string[]): void {
  const known = new Set(knownFields);
  if (!known.has(rule.amountField)) throw new DetectorError(`amountField '${rule.amountField}' not in schema`);
  const walk = (c: Condition): void => {
    if (c.kind === 'compare') {
      if (!known.has(c.field)) throw new DetectorError(`Field '${c.field}' not in schema`);
    } else if (c.kind === 'and' || c.kind === 'or') {
      if (c.clauses.length === 0) throw new DetectorError(`'${c.kind}' requires at least one clause`);
      c.clauses.forEach(walk);
    } else {
      walk(c.clause);
    }
  };
  walk(rule.when);
}
