/**
 * Observability & operational metrics (S26).
 *
 * The metrics an ops lead and a customer-success team watch to know the system is healthy:
 * detection latency, mean-time-to-resolution (MTTR), queue depth, recovery velocity, and SLA
 * attainment. Pure functions over timestamped events; deterministic and percentile-aware.
 */
export class MetricsError extends Error {
  constructor(message: string) { super(message); this.name = 'MetricsError'; }
}

export interface CaseLifecycleEvent {
  readonly caseId: string;
  readonly leakOccurredAt: string;  // when the leak economically began
  readonly detectedAt: string;      // when RevenueTwin surfaced it
  readonly resolvedAt: string | null; // when the case reached a terminal status
  readonly slaDueAt: string | null;
}

function hoursBetween(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) throw new MetricsError('Invalid timestamp');
  return (db - da) / 3_600_000;
}

/** Compute a percentile (0..100) over a numeric sample using linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new MetricsError('percentile of empty sample');
  if (p < 0 || p > 100) throw new MetricsError('percentile p must be in [0,100]');
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const frac = rank - low;
  return sorted[low]! * (1 - frac) + sorted[high]! * frac;
}

export interface LatencyMetrics {
  detectionLatencyHoursAvg: number; // leakOccurred -> detected
  detectionLatencyP90: number;
  mttrHoursAvg: number;             // detected -> resolved (resolved only)
  mttrP90: number;
  resolvedCount: number;
  openCount: number;
}

export function latencyMetrics(events: CaseLifecycleEvent[]): LatencyMetrics {
  const detection: number[] = [];
  const mttr: number[] = [];
  let resolved = 0, open = 0;
  for (const e of events) {
    detection.push(hoursBetween(e.leakOccurredAt, e.detectedAt));
    if (e.resolvedAt) {
      mttr.push(hoursBetween(e.detectedAt, e.resolvedAt));
      resolved += 1;
    } else {
      open += 1;
    }
  }
  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  return {
    detectionLatencyHoursAvg: round2(avg(detection)),
    detectionLatencyP90: round2(detection.length ? percentile(detection, 90) : 0),
    mttrHoursAvg: round2(avg(mttr)),
    mttrP90: round2(mttr.length ? percentile(mttr, 90) : 0),
    resolvedCount: resolved,
    openCount: open,
  };
}

/** SLA attainment: share of cases resolved before their SLA deadline (0..1). */
export function slaAttainment(events: CaseLifecycleEvent[]): { attained: number; total: number; rate: number } {
  let attained = 0, total = 0;
  for (const e of events) {
    if (e.slaDueAt === null) continue;
    total += 1;
    if (e.resolvedAt !== null && Date.parse(e.resolvedAt) <= Date.parse(e.slaDueAt)) attained += 1;
  }
  return { attained, total, rate: total === 0 ? 0 : Math.round((attained / total) * 10000) / 10000 };
}

/** Queue depth at a point in time: cases detected but not yet resolved as-of `asOf`. */
export function queueDepth(events: CaseLifecycleEvent[], asOf: string): number {
  const at = Date.parse(asOf);
  if (Number.isNaN(at)) throw new MetricsError('Invalid asOf');
  let depth = 0;
  for (const e of events) {
    const detected = Date.parse(e.detectedAt) <= at;
    const resolved = e.resolvedAt !== null && Date.parse(e.resolvedAt) <= at;
    if (detected && !resolved) depth += 1;
  }
  return depth;
}

/** Recovery velocity: cases resolved per day over a window. */
export function recoveryVelocity(events: CaseLifecycleEvent[], windowDays: number): number {
  if (windowDays <= 0) throw new MetricsError('windowDays must be > 0');
  const resolved = events.filter((e) => e.resolvedAt !== null).length;
  return Math.round((resolved / windowDays) * 100) / 100;
}
