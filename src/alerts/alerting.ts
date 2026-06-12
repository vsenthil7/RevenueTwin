/**
 * Alerting & thresholds (S44).
 *
 * Configurable alerts over operational/financial metrics with severity, hysteresis (to avoid
 * flapping), and deduplication. Deterministic state machine: an alert fires when a metric crosses
 * its threshold and only clears after recovering past a separate clear-threshold. Clock-injectable.
 */
export class AlertError extends Error {
  constructor(message: string) { super(message); this.name = 'AlertError'; }
}

export type Severity = 'info' | 'warning' | 'critical';
export type Direction = 'above' | 'below';

export interface AlertRule {
  readonly id: string;
  readonly metric: string;
  readonly direction: Direction;   // fire when value goes above/below fireThreshold
  readonly fireThreshold: number;
  readonly clearThreshold: number; // hysteresis: must cross back past this to clear
  readonly severity: Severity;
}

export type AlertState = 'ok' | 'firing';

export interface AlertEvent {
  readonly ruleId: string;
  readonly transition: 'fired' | 'cleared';
  readonly value: number;
  readonly at: string;
  readonly severity: Severity;
}

function validateRule(rule: AlertRule): void {
  if (rule.direction === 'above' && rule.clearThreshold > rule.fireThreshold) {
    throw new AlertError(`'above' rule ${rule.id}: clearThreshold must be <= fireThreshold`);
  }
  if (rule.direction === 'below' && rule.clearThreshold < rule.fireThreshold) {
    throw new AlertError(`'below' rule ${rule.id}: clearThreshold must be >= fireThreshold`);
  }
}

function shouldFire(rule: AlertRule, value: number): boolean {
  return rule.direction === 'above' ? value > rule.fireThreshold : value < rule.fireThreshold;
}

function shouldClear(rule: AlertRule, value: number): boolean {
  return rule.direction === 'above' ? value <= rule.clearThreshold : value >= rule.clearThreshold;
}

/**
 * Stateful alert engine. `observe` feeds a metric value; it emits an event only on a state
 * transition (fired/cleared) — repeated values in the same state are deduplicated (no event).
 */
export class AlertEngine {
  private rules = new Map<string, AlertRule>();
  private states = new Map<string, AlertState>();
  private history: AlertEvent[] = [];

  constructor(private clock: () => string = () => new Date().toISOString()) {}

  register(rule: AlertRule): void {
    validateRule(rule);
    if (this.rules.has(rule.id)) throw new AlertError(`Duplicate rule ${rule.id}`);
    this.rules.set(rule.id, rule);
    this.states.set(rule.id, 'ok');
  }

  /** Feed a value for a rule's metric. Returns an event on transition, else null (deduped). */
  observe(ruleId: string, value: number): AlertEvent | null {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new AlertError(`Unknown rule ${ruleId}`);
    const state = this.states.get(ruleId)!;

    if (state === 'ok' && shouldFire(rule, value)) {
      this.states.set(ruleId, 'firing');
      const ev: AlertEvent = { ruleId, transition: 'fired', value, at: this.clock(), severity: rule.severity };
      this.history.push(ev);
      return ev;
    }
    if (state === 'firing' && shouldClear(rule, value)) {
      this.states.set(ruleId, 'ok');
      const ev: AlertEvent = { ruleId, transition: 'cleared', value, at: this.clock(), severity: rule.severity };
      this.history.push(ev);
      return ev;
    }
    return null; // no transition -> deduped
  }

  stateOf(ruleId: string): AlertState {
    const s = this.states.get(ruleId);
    if (s === undefined) throw new AlertError(`Unknown rule ${ruleId}`);
    return s;
  }

  firingRules(): string[] {
    return [...this.states.entries()].filter(([, s]) => s === 'firing').map(([id]) => id);
  }

  events(ruleId?: string): AlertEvent[] {
    return ruleId === undefined ? [...this.history] : this.history.filter((e) => e.ruleId === ruleId);
  }
}
