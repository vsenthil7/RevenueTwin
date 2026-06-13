/**
 * Deterministic seed: boots the standard portfolio and prints a manifest (case ids, customers,
 * recoverable, Work IQ provenance) plus the audit head hash. Deterministic clock so output is
 * reproducible; used to sanity-check the seeded scenario. `make seed`.
 */
import { bootstrap } from '../src/app/bootstrap.ts';
import { fmtMinor } from './_fmt.ts';

async function main() {
  let clock = Date.parse('2026-04-01T00:00:00.000Z');
  const tick = () => { const iso = new Date(clock).toISOString(); clock += 1000; return iso; };
  const { app, users } = await bootstrap({ clock: tick });
  const cfo = users.authenticate('cfo');
  const cases = await app.listCases(cfo);

  process.stdout.write('RevenueTwin seed manifest\n');
  process.stdout.write('-------------------------\n');
  for (const c of cases) {
    const tag = c.detectedViaWorkIQ ? '[WORK IQ]' : '         ';
    const net = c.findings.reduce((s, f) => s + f.netRecoverable.amount, 0);
    process.stdout.write(tag + ' ' + c.customerId.padEnd(12) + ' ' + c.id.padEnd(34) + ' ' + fmtMinor(net) + '\n');
  }
  const total = await app.totalRecoverable(cfo);
  process.stdout.write('-------------------------\n');
  process.stdout.write('cases: ' + cases.length + '   total recoverable: ' + fmtMinor(total.amount) + '\n');
  const intact = await app.auditIntact(cfo);
  process.stdout.write('audit chain intact: ' + intact + '\n');
  if (!intact || cases.length < 6) { process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
