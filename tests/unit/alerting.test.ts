import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertError, AlertEngine, type AlertRule } from '../../src/alerts/alerting.ts';

function clockSeq(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

const aboveRule: AlertRule = {
  id: 'queue-depth', metric: 'queue', direction: 'above',
  fireThreshold: 100, clearThreshold: 80, severity: 'warning',
};
const belowRule: AlertRule = {
  id: 'sla-rate', metric: 'sla', direction: 'below',
  fireThreshold: 0.9, clearThreshold: 0.95, severity: 'critical',
};

test('register validates hysteresis direction', () => {
  const e = new AlertEngine();
  assert.throws(() => e.register({ ...aboveRule, clearThreshold: 120 }), AlertError); // above: clear must be <= fire
  assert.throws(() => e.register({ ...belowRule, clearThreshold: 0.8 }), AlertError);  // below: clear must be >= fire
});

test('register rejects duplicate ids', () => {
  const e = new AlertEngine();
  e.register(aboveRule);
  assert.throws(() => e.register(aboveRule), AlertError);
});

test('above rule fires on crossing and clears only past hysteresis', () => {
  const e = new AlertEngine(clockSeq(['t0', 't1', 't2', 't3']));
  e.register(aboveRule);
  assert.equal(e.observe('queue-depth', 50), null); // below fire -> ok
  const fired = e.observe('queue-depth', 150);
  assert.equal(fired!.transition, 'fired');
  assert.equal(e.stateOf('queue-depth'), 'firing');
  // value 90 is below fire(100) but above clear(80) -> stays firing (hysteresis), no event
  assert.equal(e.observe('queue-depth', 90), null);
  const cleared = e.observe('queue-depth', 70); // <= clear 80
  assert.equal(cleared!.transition, 'cleared');
  assert.equal(e.stateOf('queue-depth'), 'ok');
});

test('below rule fires when value drops and clears when it recovers', () => {
  const e = new AlertEngine(clockSeq(['t0', 't1']));
  e.register(belowRule);
  const fired = e.observe('sla-rate', 0.85); // < 0.9
  assert.equal(fired!.transition, 'fired');
  const cleared = e.observe('sla-rate', 0.96); // >= 0.95
  assert.equal(cleared!.transition, 'cleared');
});

test('repeated values in the same state are deduplicated', () => {
  const e = new AlertEngine(clockSeq(['t0', 't1', 't2']));
  e.register(aboveRule);
  e.observe('queue-depth', 150); // fired
  assert.equal(e.observe('queue-depth', 160), null); // still firing -> no event
  assert.equal(e.observe('queue-depth', 200), null);
});

test('observe and stateOf reject unknown rules', () => {
  const e = new AlertEngine();
  assert.throws(() => e.observe('nope', 1), AlertError);
  assert.throws(() => e.stateOf('nope'), AlertError);
});

test('firingRules lists currently-firing rules; events filter by rule', () => {
  const e = new AlertEngine(clockSeq(['t0', 't1']));
  e.register(aboveRule);
  e.register(belowRule);
  e.observe('queue-depth', 150);
  assert.deepEqual(e.firingRules(), ['queue-depth']);
  assert.equal(e.events().length, 1);
  assert.equal(e.events('queue-depth').length, 1);
  assert.equal(e.events('sla-rate').length, 0);
});

test('default clock stamps ISO timestamps', () => {
  const e = new AlertEngine();
  e.register(aboveRule);
  const ev = e.observe('queue-depth', 150)!;
  assert.match(ev.at, /^\d{4}-\d{2}-\d{2}T/);
});
