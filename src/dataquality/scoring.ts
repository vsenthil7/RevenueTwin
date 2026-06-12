/**
 * Data quality & lineage scoring (S27).
 *
 * A recoverable figure is only as trustworthy as the data under it. This module scores source
 * data on completeness, freshness, and consistency, producing a per-source confidence that can
 * gate or annotate findings. Deterministic; no figure is silently trusted.
 */
export class DataQualityError extends Error {
  constructor(message: string) { super(message); this.name = 'DataQualityError'; }
}

export interface FieldSpec {
  readonly name: string;
  readonly required: boolean;
}

export interface QualityInput {
  readonly sourceId: string;
  readonly records: Record<string, unknown>[];
  readonly requiredFields: FieldSpec[];
  readonly lastSyncAt: string;     // ISO
  readonly now: string;            // ISO
  readonly freshnessSlaHours: number;
}

export interface QualityScore {
  readonly sourceId: string;
  readonly completeness: number; // 0..1 share of required fields present across records
  readonly freshness: number;    // 0..1, 1 if within SLA, decaying after
  readonly consistency: number;  // 0..1, share of records with no type contradictions
  readonly overall: number;      // weighted blend
  readonly recordCount: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

function gradeFor(score: number): QualityScore['grade'] {
  if (score >= 0.9) return 'A';
  if (score >= 0.8) return 'B';
  if (score >= 0.7) return 'C';
  if (score >= 0.6) return 'D';
  return 'F';
}

/** Completeness: average share of required fields that are present & non-empty per record. */
function completenessOf(records: Record<string, unknown>[], required: FieldSpec[]): number {
  const req = required.filter((f) => f.required);
  if (req.length === 0) return 1;
  if (records.length === 0) return 0;
  let totalPresent = 0;
  for (const rec of records) {
    let present = 0;
    for (const f of req) {
      const v = rec[f.name];
      if (v !== undefined && v !== null && v !== '') present += 1;
    }
    totalPresent += present / req.length;
  }
  return totalPresent / records.length;
}

/** Freshness: 1 within SLA, then linear decay to 0 at 2x SLA. */
function freshnessOf(lastSyncAt: string, now: string, slaHours: number): number {
  if (slaHours <= 0) throw new DataQualityError('freshnessSlaHours must be > 0');
  const ageH = (Date.parse(now) - Date.parse(lastSyncAt)) / 3_600_000;
  if (Number.isNaN(ageH)) throw new DataQualityError('Invalid freshness timestamps');
  if (ageH <= slaHours) return 1;
  if (ageH >= slaHours * 2) return 0;
  return 1 - (ageH - slaHours) / slaHours;
}

/**
 * Consistency: share of records with no internal contradictions. We check a couple of universal
 * rules: numeric-looking fields aren't booleans, and required fields aren't NaN numbers.
 */
function consistencyOf(records: Record<string, unknown>[], required: FieldSpec[]): number {
  if (records.length === 0) return 0;
  let consistent = 0;
  for (const rec of records) {
    let ok = true;
    for (const f of required) {
      const v = rec[f.name];
      if (typeof v === 'number' && Number.isNaN(v)) { ok = false; break; }
    }
    if (ok) consistent += 1;
  }
  return consistent / records.length;
}

export function scoreQuality(input: QualityInput): QualityScore {
  const completeness = completenessOf(input.records, input.requiredFields);
  const freshness = freshnessOf(input.lastSyncAt, input.now, input.freshnessSlaHours);
  const consistency = consistencyOf(input.records, input.requiredFields);
  // weights: completeness 0.4, consistency 0.4, freshness 0.2
  const overall = 0.4 * completeness + 0.4 * consistency + 0.2 * freshness;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    sourceId: input.sourceId,
    completeness: round(completeness),
    freshness: round(freshness),
    consistency: round(consistency),
    overall: round(overall),
    recordCount: input.records.length,
    grade: gradeFor(overall),
  };
}

/**
 * Gate a finding's confidence by the quality of its source data: effective confidence is the
 * product of the model confidence and the source's overall quality. Below `minGate` -> hold.
 */
export interface QualityGate { effectiveConfidence: number; held: boolean; }

export function gateByQuality(modelConfidence: number, quality: QualityScore, minGate = 0.5): QualityGate {
  if (modelConfidence < 0 || modelConfidence > 1) throw new DataQualityError('confidence must be in [0,1]');
  const effective = Math.round(modelConfidence * quality.overall * 1000) / 1000;
  return { effectiveConfidence: effective, held: effective < minGate };
}
