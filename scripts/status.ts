/**
 * System status report: boots the app and prints health, persistence backend, RBAC roles, and a
 * portfolio/audit summary. Read-only. `make status`.
 */
import { bootstrap } from '../src/app/bootstrap.ts';
import { fmtMinor } from './_fmt.ts';

async function main() {
  let clock = Date.parse('2026-04-01T00:00:00.000Z');
  const tick = () => { const iso = new Date(clock).toISOString(); clock += 1000; return iso; };
  const { app, users, backend } = await bootstrap({ clock: tick });
  const cfo = users.authenticate('cfo');
  const summary = await app.portfolioSummary(cfo);
  const intact = await app.auditIntact(cfo);
  const w = (k: string, v: string) => process.stdout.write(k.padEnd(22) + v + '\n');
  process.stdout.write('RevenueTwin status\n==================\n');
  w('health', 'ok');
  w('tenant', app.tenantId);
  w('currency', app.currency);
  w('persistence backend', backend);
  w('provisioned users', users.list().map((u) => u.id).join(', '));
  w('open cases', String(summary.totalCases));
  w('recoverable', fmtMinor(summary.totalRecoverable.amount));
  w('work iq attributable', fmtMinor(summary.workIQAttributable.amount));
  w('audit chain', intact ? 'intact' : 'BROKEN');
  if (!intact) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
