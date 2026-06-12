import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectorRegistry, PlatformError,
  type ConnectorDescriptor, type WebhookSubscription,
} from '../../src/api/platform.ts';

function desc(over: Partial<ConnectorDescriptor> = {}): ConnectorDescriptor {
  return { id: 'sf', name: 'Salesforce', category: 'crm', health: 'healthy', mode: 'live', ...over };
}

test('register adds a connector (stored as a copy)', () => {
  const r = new ConnectorRegistry();
  const d = desc();
  r.register(d);
  const got = r.get('sf');
  assert.equal(got?.name, 'Salesforce');
  assert.notEqual(got, d); // defensive copy
});

test('register rejects duplicate id', () => {
  const r = new ConnectorRegistry();
  r.register(desc());
  assert.throws(() => r.register(desc()), PlatformError);
});

test('setHealth and setMode mutate the stored connector', () => {
  const r = new ConnectorRegistry();
  r.register(desc());
  r.setHealth('sf', 'degraded');
  r.setMode('sf', 'fixture');
  const got = r.get('sf')!;
  assert.equal(got.health, 'degraded');
  assert.equal(got.mode, 'fixture');
});

test('setHealth/setMode throw on unknown connector', () => {
  const r = new ConnectorRegistry();
  assert.throws(() => r.setHealth('nope', 'healthy'), PlatformError);
  assert.throws(() => r.setMode('nope', 'live'), PlatformError);
});

test('get returns null for unknown', () => {
  const r = new ConnectorRegistry();
  assert.equal(r.get('nope'), null);
});

test('list returns all as defensive copies', () => {
  const r = new ConnectorRegistry();
  r.register(desc());
  r.register(desc({ id: 'stripe', name: 'Stripe', category: 'billing' }));
  const all = r.list();
  assert.equal(all.length, 2);
  all[0]!.health = 'unavailable';
  assert.equal(r.get(all[0]!.id)!.health, 'healthy'); // copy didn't leak
});

test('byHealth filters', () => {
  const r = new ConnectorRegistry();
  r.register(desc());
  r.register(desc({ id: 'stripe', name: 'Stripe', category: 'billing', health: 'degraded' }));
  assert.deepEqual(r.byHealth('degraded').map((c) => c.id), ['stripe']);
});

test('allHealthy reflects connector health', () => {
  const r = new ConnectorRegistry();
  assert.equal(r.allHealthy(), true); // vacuous
  r.register(desc());
  assert.equal(r.allHealthy(), true);
  r.register(desc({ id: 'stripe', name: 'Stripe', category: 'billing', health: 'unavailable' }));
  assert.equal(r.allHealthy(), false);
});

test('subscribe adds a webhook; duplicate rejected', () => {
  const r = new ConnectorRegistry();
  const sub: WebhookSubscription = { id: 'w1', event: 'case.created', url: 'https://x/hook', active: true };
  r.subscribe(sub);
  assert.throws(() => r.subscribe(sub), PlatformError);
});

test('subscribersFor returns active matching subscriptions', () => {
  const r = new ConnectorRegistry();
  r.subscribe({ id: 'w1', event: 'case.created', url: 'https://x/1', active: true });
  r.subscribe({ id: 'w2', event: 'case.created', url: 'https://x/2', active: false });
  r.subscribe({ id: 'w3', event: 'case.approved', url: 'https://x/3', active: true });
  const subs = r.subscribersFor('case.created');
  assert.deepEqual(subs.map((s) => s.id), ['w1']);
});

test('unsubscribe deactivates (idempotent, no-op on unknown)', () => {
  const r = new ConnectorRegistry();
  r.subscribe({ id: 'w1', event: 'case.created', url: 'https://x/1', active: true });
  r.unsubscribe('w1');
  assert.equal(r.subscribersFor('case.created').length, 0);
  r.unsubscribe('w1'); // idempotent
  r.unsubscribe('unknown'); // no-op
});
