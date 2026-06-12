/**
 * Scheduler (S33).
 *
 * Drives recurring work: nightly reconciliation, connector syncs, SLA sweeps. Deterministic and
 * clock-injectable. Computes due times from intervals, runs jobs, and retries failures with
 * exponential backoff up to a cap, recording every attempt in a run ledger.
 */
export class SchedulerError extends Error {
  constructor(message: string) { super(message); this.name = 'SchedulerError'; }
}

export interface JobDefinition {
  readonly id: string;
  readonly intervalMinutes: number;
  readonly maxRetries: number;
  readonly backoffBaseSeconds: number; // first retry delay; doubles each attempt
}

export interface RunRecord {
  readonly jobId: string;
  readonly attempt: number;
  readonly at: string;
  readonly outcome: 'success' | 'failure';
  readonly error?: string;
  readonly nextRetryAt?: string;
}

function addSeconds(iso: string, seconds: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new SchedulerError(`Invalid time ${iso}`);
  return new Date(t + seconds * 1000).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return addSeconds(iso, minutes * 60);
}

/** Exponential backoff delay (seconds) for a given attempt (1-based). */
export function backoffSeconds(def: JobDefinition, attempt: number): number {
  if (attempt < 1) throw new SchedulerError('attempt must be >= 1');
  return def.backoffBaseSeconds * Math.pow(2, attempt - 1);
}

/** When is the job next due after a successful run at `lastRunAt`? */
export function nextDueAt(def: JobDefinition, lastRunAt: string): string {
  if (def.intervalMinutes <= 0) throw new SchedulerError('intervalMinutes must be > 0');
  return addMinutes(lastRunAt, def.intervalMinutes);
}

/** Is the job due as-of `now` given its last run (null = never run, so due)? */
export function isDue(def: JobDefinition, lastRunAt: string | null, now: string): boolean {
  if (lastRunAt === null) return true;
  return Date.parse(now) >= Date.parse(nextDueAt(def, lastRunAt));
}

export type JobFn = () => Promise<void>;

/**
 * Run a job with retry/backoff. Returns the full attempt ledger. Stops at first success or after
 * maxRetries failures. Deterministic: uses the injected clock for timestamps.
 */
export class JobRunner {
  private ledger: RunRecord[] = [];

  constructor(private clock: () => string = () => new Date().toISOString()) {}

  async run(def: JobDefinition, fn: JobFn): Promise<RunRecord[]> {
    const records: RunRecord[] = [];
    // attempt 0 is the initial try; retries are 1..maxRetries
    for (let attempt = 0; attempt <= def.maxRetries; attempt++) {
      const at = this.clock();
      try {
        await fn();
        const rec: RunRecord = { jobId: def.id, attempt, at, outcome: 'success' };
        records.push(rec);
        this.ledger.push(rec);
        return records;
      } catch (e) {
        const isLast = attempt === def.maxRetries;
        const rec: RunRecord = {
          jobId: def.id, attempt, at, outcome: 'failure',
          error: e instanceof Error ? e.message : `${e}`,
          ...(isLast ? {} : { nextRetryAt: addSeconds(at, backoffSeconds(def, attempt + 1)) }),
        };
        records.push(rec);
        this.ledger.push(rec);
      }
    }
    return records;
  }

  history(jobId?: string): RunRecord[] {
    return jobId === undefined ? [...this.ledger] : this.ledger.filter((r) => r.jobId === jobId);
  }
}

/** A simple due-job selector over a set of definitions and their last-run times. */
export function dueJobs(
  defs: JobDefinition[], lastRuns: Map<string, string>, now: string,
): JobDefinition[] {
  return defs.filter((d) => isDue(d, lastRuns.get(d.id) ?? null, now));
}
