/**
 * Live integration demo. Boots the REAL API server in-process, drives it over HTTP exactly as a
 * browser would, and prints the Work IQ proof end-to-end:
 *   - blind (Work IQ off) vs sighted (Work IQ on) recall on the planted Northwind leak
 *   - a real approve decision written through the API and into the tamper-evident audit chain
 *   - audit chain verified intact after the write
 *
 * Run: npm run demo:live   (exits non-zero on any assertion failure)
 */
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { bootstrap, northwindFindings } from './bootstrap.ts';
import { createApiServer } from './server.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`❌ ${msg}`); process.exit(1); }
}

const fmtGBP = (minor: number) => '£' + (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 });

const { app, users } = await bootstrap({ seedCase: true });
const server = createApiServer({ app, users, webRoot: '/tmp' });
server.listen(0);
await once(server, 'listening');
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const cfo = { 'x-user-id': 'cfo', 'content-type': 'application/json' };
const auditor = { 'x-user-id': 'auditor' };

try {
  console.log('\n  RevenueTwin — Live Integration Demo (real HTTP API)\n  ' + '─'.repeat(52));

  // 1. Moat: blind vs sighted recall over the planted intent-only leak.
  const blind = northwindFindings(false).length;   // Work IQ off
  const sighted = northwindFindings(true).length;   // Work IQ on
  console.log(`\n  Work IQ moat (planted QBR uplift, never billed):`);
  console.log(`    blind  (Work IQ OFF): ${blind} leak(s) detected — £0 recoverable`);
  console.log(`    sighted (Work IQ ON): ${sighted} leak(s) detected`);
  assert(blind === 0 && sighted === 1, 'blind-vs-sighted recall must be 0 vs 1');

  // 2. The seeded case is visible over the wire with its recoverable amount.
  const cases = await (await fetch(`${base}/api/cases`, { headers: cfo })).json();
  assert(cases.length === 1, 'exactly one seeded case expected');
  const net = cases[0].findings.reduce((s: number, f: { netRecoverable: { amount: number } }) => s + f.netRecoverable.amount, 0);
  console.log(`\n  Case over HTTP: ${cases[0].customerId} — ${fmtGBP(net)} net recoverable, Work IQ=${cases[0].detectedViaWorkIQ}`);
  assert(net === 120000, 'net recoverable must be £1,200.00');

  // 3. Portfolio attribution.
  const portfolio = await (await fetch(`${base}/api/portfolio`, { headers: cfo })).json();
  console.log(`  Portfolio: ${fmtGBP(portfolio.totalRecoverable.amount)} recoverable, ` +
    `${fmtGBP(portfolio.workIQAttributable.amount)} Work-IQ-attributable`);
  assert(portfolio.workIQAttributable.amount === 120000, 'full amount must be Work IQ attributable');

  // 4. RBAC: unauthenticated read is refused.
  const noauth = await fetch(`${base}/api/cases`);
  assert(noauth.status === 403, 'unauthenticated request must be 403');
  console.log(`\n  RBAC: unauthenticated /api/cases -> ${noauth.status} (refused)`);

  // 5. Human-gated approval, written through the API into the audit chain.
  const decided = await (await fetch(`${base}/api/cases/${encodeURIComponent(cases[0].id)}/decision`, {
    method: 'POST', headers: cfo, body: JSON.stringify({ decision: 'approve' }),
  })).json();
  assert(decided.status === 'approved', 'case must transition to approved');
  console.log(`  Decision: case ${decided.id} -> ${decided.status} (CFO, audited)`);

  // 6. Audit chain verified intact after the write.
  const audit = await (await fetch(`${base}/api/audit`, { headers: auditor })).json();
  console.log(`  Audit: ${audit.entries.length} entries, chain intact=${audit.intact}`);
  assert(audit.intact === true, 'audit chain must verify intact');
  assert(audit.entries.length >= 2, 'audit must record creation + approval');

  console.log(`\n  ✅ LIVE DEMO PASSED — moat proven over real HTTP, RBAC enforced, audit intact.\n`);
} finally {
  server.close();
}
