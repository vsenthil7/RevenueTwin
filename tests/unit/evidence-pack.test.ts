import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceError, buildEvidencePack, verifyEvidencePack, effectiveControlCount, isCleanAttestation,
  type ControlAttestation, type EvidencePack,
} from '../../src/evidence/evidence-pack.ts';
import { AuditLog } from '../../src/core/audit.ts';
import { money } from '../../src/money/money.ts';
import type { LeakageCase } from '../../src/core/model.ts';

function caseOf(id: string, net: number, workIQ?: boolean): LeakageCase {
  return {
    id, customerId: 'acme', status: 'approved', createdAt: '2026-01-01',
    findings: [{ id: `${id}-f`, type: 'intent', netRecoverable: money(net, 'GBP') }],
    ...(workIQ !== undefined ? { detectedViaWorkIQ: workIQ } : {}),
  };
}

const controls: ControlAttestation[] = [
  { controlId: 'RC-01', name: 'Reconciliation completeness', operatingEffectively: true, evidenceCount: 5 },
  { controlId: 'RC-02', name: 'Dual approval', operatingEffectively: true, evidenceCount: 3 },
];

function pack(over: Partial<Parameters<typeof buildEvidencePack>[0]> = {}): EvidencePack {
  const log = new AuditLog(() => '2026-01-01T00:00:00Z');
  log.append('alice', 'case.created', 'c1', {});
  return buildEvidencePack({
    tenantId: 't1', periodFrom: '2026-01-01', periodTo: '2026-01-31', generatedAt: '2026-02-01',
    cases: [caseOf('c1', 1200_00, true), caseOf('c2', 800_00)],
    auditEntries: log.all(), controls, currency: 'GBP', ...over,
  });
}

test('buildEvidencePack summarizes cases, totals, and ties to audit head', () => {
  const p = pack();
  assert.equal(p.cases.length, 2);
  assert.equal(p.totals.totalCases, 2);
  assert.equal(p.totals.totalRecoverableMajor, 2000); // £2,000.00 in major units
  assert.equal(p.auditEntryCount, 1);
  assert.notEqual(p.auditHeadHash, '0'.repeat(64));
  assert.equal(p.cases[0]!.detectedViaWorkIQ, true);
  assert.equal(p.cases[1]!.detectedViaWorkIQ, false); // defaulted
});

test('buildEvidencePack uses genesis head hash when no audit entries', () => {
  const p = pack({ auditEntries: [] });
  assert.equal(p.auditHeadHash, '0'.repeat(64));
  assert.equal(p.auditEntryCount, 0);
});

test('buildEvidencePack rejects an inverted period', () => {
  assert.throws(() => pack({ periodFrom: '2026-02-01', periodTo: '2026-01-01' }), EvidenceError);
});

test('verifyEvidencePack confirms integrity and detects tampering', () => {
  const p = pack();
  assert.equal(verifyEvidencePack(p), true);
  const tampered: EvidencePack = { ...p, totals: { ...p.totals, totalRecoverableMajor: 9999 } };
  assert.equal(verifyEvidencePack(tampered), false);
});

test('effectiveControlCount and isCleanAttestation', () => {
  const clean = pack();
  assert.equal(effectiveControlCount(clean), 2);
  assert.equal(isCleanAttestation(clean), true);
  const dirty = pack({ controls: [{ controlId: 'RC-01', name: 'x', operatingEffectively: false, evidenceCount: 0 }] });
  assert.equal(effectiveControlCount(dirty), 0);
  assert.equal(isCleanAttestation(dirty), false);
  const empty = pack({ controls: [] });
  assert.equal(isCleanAttestation(empty), false); // no controls is not "clean"
});
