/**
 * Offline Golden Thread demo (no network). Proves the Work IQ moat: the £1,200 Northwind leak is
 * INVISIBLE without commercial-intent detection and RECOVERED with it, end-to-end through the real
 * engine (reconciliation + Work IQ + app facade + tamper-evident audit). Required deliverable:
 * `make demo-offline`.
 */
import { bootstrap, northwindFindings } from '../src/app/bootstrap.ts';
import { fmtMinor } from './_fmt.ts';

function line(s = '') { process.stdout.write(s + '\n'); }

async function main() {
  let clock = Date.parse('2026-04-01T00:00:00.000Z');
  const tick = () => { const iso = new Date(clock).toISOString(); clock += 1000; return iso; };

  line('==============================================================');
  line('  RevenueTwin — Golden Thread (offline, deterministic)');
  line('==============================================================');
  line();

  // 1) Blind vs sighted: the moat.
  const blind = northwindFindings(false);
  const sighted = northwindFindings(true);
  line('1) BLIND vs SIGHTED (single planted intent-only leak)');
  line('   Work IQ OFF  -> findings: ' + blind.length + '  (recall 0%)');
  line('   Work IQ ON   -> findings: ' + sighted.length + '  (recall 100%)');
  const leak = sighted[0]!;
  line('   Recoverable detected ONLY via commercial intent: ' + fmtMinor(leak.netRecoverable.amount));
  line();

  // 2) End-to-end through the real app: open -> approve -> audit.
  const { app, users } = await bootstrap({ clock: tick });
  const cfo = users.authenticate('cfo');
  const opened = await app.openCase(cfo, 'northwind', sighted, true, tick());
  line('2) GOLDEN THREAD');
  line('   opened case  ' + opened.id + '  status=' + opened.status);
  const approved = await app.decideCase(cfo, opened.id, 'approve', tick());
  line('   approved     ' + approved.id + '  status=' + approved.status);

  // 3) Tamper-evident audit.
  const intact = await app.auditIntact(cfo);
  const trail = await app.auditTrail(cfo);
  line('3) AUDIT');
  line('   entries: ' + trail.length + '   chain intact: ' + intact);
  line();

  // 4) Portfolio headline.
  const summary = await app.portfolioSummary(cfo);
  line('4) PORTFOLIO');
  line('   cases: ' + summary.totalCases + '   recoverable: ' + fmtMinor(summary.totalRecoverable.amount));
  line('   Work IQ attributable: ' + fmtMinor(summary.workIQAttributable.amount));
  line();

  // Assertions — fail loudly if the moat or the thread breaks.
  const ok = blind.length === 0 && sighted.length === 1 && leak.netRecoverable.amount === 120000
    && approved.status === 'approved' && intact === true;
  if (!ok) { line('DEMO FAILED: invariant broken'); process.exit(1); }
  line('OK Golden Thread proven: £1,200.00 recovered, audit intact, moat = 1.0 recall delta.');
}

main().catch((e) => { console.error(e); process.exit(1); });
