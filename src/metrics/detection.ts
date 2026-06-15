/**
 * Detection metrics (S84) - shared standard E.6.
 *
 * Every RevenueTwin detector is measured against the SEED_MANIFEST.md ground truth: each planted
 * defect has a known id, and a detection run produces a set of detected ids. We compute
 * precision / recall / F1 deterministically, plus a regression gate so a drop fails the build.
 */
export class MetricsError extends Error {
  constructor(message: string) { super(message); this.name = 'MetricsError'; }
}

export interface DetectionScore {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

/** Score detected ids against the planted (ground-truth) ids. */
export function score(planted: readonly string[], detected: readonly string[]): DetectionScore {
  const plantedSet = new Set(planted);
  const detectedSet = new Set(detected);
  let tp = 0;
  for (const d of detectedSet) if (plantedSet.has(d)) tp++;
  const fp = detectedSet.size - tp;
  const fn = plantedSet.size - tp;
  const precision = detectedSet.size === 0 ? (plantedSet.size === 0 ? 1 : 0) : tp / detectedSet.size;
  const recall = plantedSet.size === 0 ? 1 : tp / plantedSet.size;
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { truePositives: tp, falsePositives: fp, falseNegatives: fn, precision, recall, f1 };
}

/** A regression gate: assert a fresh score is not materially worse than the committed baseline. */
export function assertNoRegression(baseline: DetectionScore, current: DetectionScore, tolerance = 0.01): void {
  if (current.recall < baseline.recall - tolerance) {
    throw new MetricsError('recall regressed: ' + current.recall + ' < baseline ' + baseline.recall);
  }
  if (current.precision < baseline.precision - tolerance) {
    throw new MetricsError('precision regressed: ' + current.precision + ' < baseline ' + baseline.precision);
  }
}
