import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TenancyError, TenantRegistry, EDITION_FEATURES, EDITION_LIMITS,
  type TenantConfig,
} from '../../src/tenancy/config.ts';

function config(over: Partial<TenantConfig> = {}): TenantConfig {
  return { tenantId: 't1', edition: 'work_iq', featureOverrides: {}, reportingCurrency: 'GBP', settings: {}, ...over };
}

test('register / get / duplicate / not-found', () => {
  const r = new TenantRegistry();
  r.register(config());
  assert.equal(r.get('t1').edition, 'work_iq');
  assert.throws(() => r.register(config()), TenancyError);
  assert.throws(() => r.get('missing'), TenancyError);
});

test('hasFeature reflects edition grants', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'assurance_core' }));
  assert.equal(r.hasFeature('t1', 'reconciliation'), true);
  assert.equal(r.hasFeature('t1', 'work_iq'), false);
});

test('feature override wins over edition (both grant and deny)', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'assurance_core', featureOverrides: { work_iq: true, reconciliation: false } }));
  assert.equal(r.hasFeature('t1', 'work_iq'), true);   // granted by override
  assert.equal(r.hasFeature('t1', 'reconciliation'), false); // denied by override
});

test('requireFeature throws when not entitled', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'assurance_core' }));
  assert.doesNotThrow(() => r.requireFeature('t1', 'audit'));
  assert.throws(() => r.requireFeature('t1', 'forecasting'), TenancyError);
});

test('limits returns edition limits', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'enterprise_os' }));
  assert.equal(r.limits('t1').maxConnectors, EDITION_LIMITS.enterprise_os.maxConnectors);
});

test('consume meters resources and refuses past the limit', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'assurance_core' })); // maxConnectors 3
  assert.equal(r.consume('t1', 'connectors'), true);
  assert.equal(r.consume('t1', 'connectors'), true);
  assert.equal(r.consume('t1', 'connectors'), true);
  assert.equal(r.consume('t1', 'connectors'), false); // 4th exceeds
  assert.equal(r.usageOf('t1').connectors, 3);
});

test('consume handles users and cases resources', () => {
  const r = new TenantRegistry();
  r.register(config({ edition: 'work_iq' }));
  assert.equal(r.consume('t1', 'users'), true);
  assert.equal(r.consume('t1', 'casesThisMonth'), true);
  assert.equal(r.usageOf('t1').users, 1);
  assert.equal(r.usageOf('t1').casesThisMonth, 1);
});

test('resetMonthly clears the case counter; throws for unknown tenant', () => {
  const r = new TenantRegistry();
  r.register(config());
  r.consume('t1', 'casesThisMonth');
  r.resetMonthly('t1');
  assert.equal(r.usageOf('t1').casesThisMonth, 0);
  assert.throws(() => r.resetMonthly('missing'), TenancyError);
});

test('setting returns stored value or fallback', () => {
  const r = new TenantRegistry();
  r.register(config({ settings: { recoveryRate: 0.6, label: 'pilot' } }));
  assert.equal(r.setting('t1', 'recoveryRate', 0.5), 0.6);
  assert.equal(r.setting('t1', 'label', 'default'), 'pilot');
  assert.equal(r.setting('t1', 'missing', 42), 42);
});

test('edition feature tables are cumulative tiers', () => {
  // every assurance_core feature is also in work_iq and enterprise_os
  for (const f of EDITION_FEATURES.assurance_core) {
    assert.ok(EDITION_FEATURES.work_iq.includes(f));
    assert.ok(EDITION_FEATURES.enterprise_os.includes(f));
  }
});
