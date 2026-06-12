/**
 * Anomaly detection (S23).
 *
 * Catches leakage that rule-based reconciliation misses: statistical outliers in billing/usage.
 * Deterministic, dependency-free statistics. Anomalies are SIGNALS for human review, never
 * autonomous actions — they feed the case queue with a confidence, not a write.
 */
import { toDecimal, type Money } from '../money/money.ts';

export class AnomalyError extends Error {
  constructor(message: string) { super(message); this.name = 'AnomalyError'; }
}

export interface Observation {
  readonly id: string;
  readonly period: string; // e.g. YYYY-MM
  readonly value: number;  // numeric metric (revenue major units, usage units, etc.)
}

export interface Stats { mean: number; std: number; median: number; mad: number; n: number; }

export function computeStats(values: number[]): Stats {
  const n = values.length;
  if (n === 0) throw new AnomalyError('Cannot compute stats over empty series');
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const deviations = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = n % 2 === 1 ? deviations[(n - 1) / 2]! : (deviations[n / 2 - 1]! + deviations[n / 2]!) / 2;
  return { mean, std, median, mad, n };
}

export type AnomalyMethod = 'zscore' | 'mad';

export interface Anomaly {
  readonly observation: Observation;
  readonly score: number;     // |z| or robust score
  readonly direction: 'high' | 'low';
  readonly method: AnomalyMethod;
  readonly confidence: number; // 0..1, mapped from score
}

/** Map a score to a 0..1 confidence (saturating). A score at/above 2*threshold -> ~1. */
function scoreToConfidence(score: number, threshold: number): number {
  const c = (score - threshold) / threshold; // 0 at threshold, 1 at 2*threshold
  return Math.max(0, Math.min(1, c));
}

/**
 * Detect anomalies in a series. `zscore` uses mean/std; `mad` uses the robust median/MAD
 * (better with outliers). Observations beyond `threshold` are flagged.
 */
export function detectAnomalies(
  series: Observation[], method: AnomalyMethod = 'mad', threshold = 3,
): Anomaly[] {
  if (threshold <= 0) throw new AnomalyError('threshold must be > 0');
  if (series.length < 3) return []; // not enough data to judge
  const stats = computeStats(series.map((o) => o.value));
  const out: Anomaly[] = [];

  for (const obs of series) {
    let score: number;
    if (method === 'zscore') {
      if (stats.std === 0) continue; // no variance, nothing anomalous
      score = Math.abs(obs.value - stats.mean) / stats.std;
    } else {
      // robust: 0.6745 scales MAD to be comparable to std for normal data
      if (stats.mad === 0) continue;
      score = Math.abs(0.6745 * (obs.value - stats.median) / stats.mad);
    }
    if (score >= threshold) {
      const center = method === 'zscore' ? stats.mean : stats.median;
      out.push({
        observation: obs,
        score: Math.round(score * 1000) / 1000,
        direction: obs.value >= center ? 'high' : 'low',
        method,
        confidence: Math.round(scoreToConfidence(score, threshold) * 100) / 100,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Period-over-period drop detector: flags consecutive periods where the metric falls by more
 * than `dropPct` (a revenue/usage cliff often signals an unbilled change). Series must be ordered.
 */
export interface PeriodDrop {
  readonly fromPeriod: string;
  readonly toPeriod: string;
  readonly fromValue: number;
  readonly toValue: number;
  readonly dropPct: number;
}

export function detectPeriodDrops(series: Observation[], dropPct: number): PeriodDrop[] {
  if (dropPct <= 0 || dropPct >= 100) throw new AnomalyError('dropPct must be in (0,100)');
  const drops: PeriodDrop[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    if (prev.value <= 0) continue;
    const change = ((prev.value - cur.value) / prev.value) * 100;
    if (change >= dropPct) {
      drops.push({
        fromPeriod: prev.period, toPeriod: cur.period,
        fromValue: prev.value, toValue: cur.value,
        dropPct: Math.round(change * 100) / 100,
      });
    }
  }
  return drops;
}

/** Convenience: turn a series of Money into Observations in major units. */
export function moneySeries(points: { id: string; period: string; amount: Money }[]): Observation[] {
  return points.map((p) => ({ id: p.id, period: p.period, value: toDecimal(p.amount) }));
}
