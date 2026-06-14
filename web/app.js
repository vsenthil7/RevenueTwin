// RevenueTwin web app. Framework-free, pure render functions for testability.
// Mirrors the backend Golden Thread output shape.

export const SCENARIO = {
  customerName: 'Northwind Traders',
  // amounts are in GBP minor units (pence)
  intentCase: {
    id: 'case-northwind',
    customer: 'Northwind Traders',
    type: 'intent_uplift_unbilled',
    grossDetected: 120000,
    netRecoverable: 120000,
    confidence: 0.88,
    detectedViaWorkIQ: true,
    provenance: {
      source: 'QBR — March 2026',
      span: 'CRO confirmed 12% uplift effective Q2',
      deepLink: 'teams://meetings/qbr-march',
      whyIntent: 'Verbal commercial commitment; no contract amendment or invoice line followed.',
    },
  },
  structuralCases: [
    { id: 'case-acme', customer: 'Acme Corp', type: 'missed_escalator', grossDetected: 45000, netRecoverable: 36000, confidence: 0.95, detectedViaWorkIQ: false },
    { id: 'case-globex', customer: 'Globex', type: 'expired_discount', grossDetected: 28000, netRecoverable: 28000, confidence: 0.91, detectedViaWorkIQ: false },
  ],
};

export function fmtGBP(minor) {
  return '£' + (minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Cases visible given Work IQ state. Intent-only cases vanish when Work IQ is off. */
export function visibleCases(workIQEnabled) {
  const cases = [...SCENARIO.structuralCases];
  if (workIQEnabled) cases.unshift(SCENARIO.intentCase);
  return cases.sort((a, b) => b.netRecoverable - a.netRecoverable);
}

/** Blind-vs-sighted recall over the single planted intent-only leak. */
export function recallState(workIQEnabled) {
  return { off: 0, on: 1, active: workIQEnabled ? 'on' : 'off' };
}

export function caseCardHTML(c, activeId) {
  const cls = ['case-card'];
  if (c.detectedViaWorkIQ) cls.push('workiq');
  if (c.id === activeId) cls.push('active');
  const badge = c.detectedViaWorkIQ ? '<span class="badge intent">WORK IQ</span>' : `<span class="badge">${c.type.replace(/_/g, ' ')}</span>`;
  return `<div class="${cls.join(' ')}" data-testid="case-${c.id}" data-case-id="${c.id}">
    <div class="case-top"><span class="case-amt">${fmtGBP(c.netRecoverable)}</span>${badge}</div>
    <div class="case-type">${c.customer}</div>
    <div class="conf">confidence ${(c.confidence * 100).toFixed(0)}% · net recoverable</div>
  </div>`;
}

export function recallBarHTML(workIQEnabled) {
  const r = recallState(workIQEnabled);
  return `<div class="recall-box off"><div class="conf">Work IQ OFF</div><div class="pct" data-testid="recall-off">${(r.off * 100).toFixed(0)}%</div></div>
    <div class="recall-box on"><div class="conf">Work IQ ON</div><div class="pct" data-testid="recall-on">${(r.on * 100).toFixed(0)}%</div></div>`;
}

export function inspectorHTML(c, decision) {
  if (!c) {
    return `<h2>Case Inspector</h2><p class="empty-state" data-testid="empty-state">Select a case from the queue to inspect evidence and decide.</p>`;
  }
  const prov = c.provenance ? `<div class="provenance" data-testid="provenance">
      <h3>Work IQ Provenance</h3>
      <div class="conf">${c.provenance.source}</div>
      <div class="span">"${c.provenance.span}"</div>
      <div class="conf">${c.provenance.whyIntent}</div>
      <a href="${c.provenance.deepLink}" data-testid="deep-link">↳ Open source meeting</a>
    </div>` : '';
  const banner = decision ? `<div class="decision-banner ${decision}" data-testid="decision-banner">Decision recorded: ${decision.toUpperCase()} · written to audit trail</div>` : '';
  const actions = decision ? '' : `<div class="actions" data-testid="actions">
      <button class="act approve" data-testid="approve-btn">Approve &amp; write</button>
      <button class="act" data-testid="edit-btn">Edit</button>
      <button class="act reject" data-testid="reject-btn">Reject</button>
      <button class="act" data-testid="escalate-btn">Escalate</button>
    </div>`;
  return `<h2>Case Inspector</h2>
    <div class="case-title" data-testid="case-title">${c.customer}</div>
    <div class="case-sub">${c.id} · ${c.type.replace(/_/g, ' ')}</div>
    <div class="grid2">
      <div class="stat"><div class="k">Gross detected</div><div class="v">${fmtGBP(c.grossDetected)}</div></div>
      <div class="stat"><div class="k">Net recoverable</div><div class="v gold" data-testid="net-recoverable">${fmtGBP(c.netRecoverable)}</div></div>
    </div>
    ${prov}
    ${actions}
    ${banner}`;
}

export function cfoCenterHTML(decisions) {
  const recovered = Object.entries(decisions)
    .filter(([, d]) => d === 'approved')
    .reduce((sum, [id]) => {
      const all = [SCENARIO.intentCase, ...SCENARIO.structuralCases];
      const c = all.find((x) => x.id === id);
      return sum + (c ? c.netRecoverable : 0);
    }, 0);
  return `<div class="cfo" data-testid="cfo-center">
    <h2>CFO Command Center</h2>
    <div class="stat" style="margin-bottom:14px"><div class="k">Recovered this session</div><div class="v green" data-testid="recovered-total">${fmtGBP(recovered)}</div></div>
  </div>`;
}

/** Dashboard: headline hero + forecast + benchmark + ROI + leakage-by-type. Pure, testable. */
export function dashboardHTML(data) {
  const { headline, insights, leakageByType, roi } = data;
  const h = headline || {};
  const ins = insights || {};
  const rr = (ins.runRate && ins.runRate.annualized) || { amount: 0 };
  const proj = (ins.projection && ins.projection.expectedRecovered) || { amount: 0 };
  const bm = ins.benchmark || {};
  const fmt = (m) => fmtGBP((m && m.amount) || 0);
  const heroes = `<div class="grid2" data-testid="dash-hero">
      <div class="stat"><div class="k">Total recoverable</div><div class="v gold" data-testid="dash-total">${fmtGBP((h.totalRecoverableMajor || 0) * 100)}</div></div>
      <div class="stat"><div class="k">Open cases</div><div class="v" data-testid="dash-count">${h.caseCount || 0}</div></div>
      <div class="stat"><div class="k">Work IQ share</div><div class="v" data-testid="dash-workiq">${Math.round((h.workIQShare || 0) * 100)}%</div></div>
      <div class="stat"><div class="k">Annualized run-rate</div><div class="v">${fmt(rr)}</div></div>
    </div>`;
  const forecast = `<div class="stat" style="margin-bottom:16px"><div class="k">Projected recovery (forecast)</div>
      <div class="v green" data-testid="dash-projection">${fmt(proj)}</div>
      <div class="conf">peer benchmark: ${(bm.quartile || 'n/a')} quartile · maturity: ${ins.recoveryMaturity || 'n/a'}</div></div>`;
  const roiBlock = roi ? `<div class="provenance" data-testid="dash-roi">
      <h3>ROI</h3>
      <div class="conf">Total annual benefit: <b>${fmt(roi.totalAnnualBenefit)}</b> · net: ${fmt(roi.netAnnualValue)}</div>
      <div class="conf">Return: <b>${roi.roiMultiple}×</b> · payback: ${roi.paybackMonths} months</div>
    </div>` : '';
  const rows = (leakageByType || []).map((l) =>
    `<tr><td>${l.type.replace(/_/g, ' ')}</td><td>${l.cases}</td><td>${fmt(l.recoverable)}</td></tr>`).join('');
  const table = `<table data-testid="dash-leakage"><thead><tr><th>Type</th><th>Cases</th><th>Recoverable</th></tr></thead><tbody>${rows}</tbody></table>`;
  return `<h2>CFO Dashboard</h2>${heroes}${forecast}${roiBlock}<div class="cfo"><h2>Leakage by type</h2>${table}</div>`;
}


export function importResultHTML(result) {
  const r = result || {};
  const total = r.totalRecoverableFormatted || "GBP 0.00";
  const summaries = r.summaries || [];
  const rejects = r.rejects || [];
  const rowsHtml = summaries.map(function (s) {
    return "<tr><td>" + s.customerId + "</td><td>" + s.findingCount + "</td><td>" + s.netRecoverableFormatted + "</td></tr>";
  }).join("");
  const rejHtml = rejects.map(function (x) {
    return "<li>row " + x.row + ": " + x.reason + "</li>";
  }).join("");
  let html = "<h2>Import result</h2>";
  html += '<div class="stat" data-testid="import-total"><div class="k">Recoverable found in your data</div><div class="v gold">' + total + "</div></div>";
  html += '<div class="conf" data-testid="import-counts">accepted ' + (r.rowsAccepted || 0) + " / rejected " + (r.rowsRejected || 0) + "</div>";
  html += '<table data-testid="import-summary"><thead><tr><th>Customer</th><th>Findings</th><th>Recoverable</th></tr></thead><tbody>' + rowsHtml + "</tbody></table>";
  if (rejHtml) html += '<div class="conf"><b>Rejected rows</b><ul data-testid="import-rejects">' + rejHtml + "</ul></div>";
  return html;
}


// S66: client-side header auto-mapping so buyer-named CSV columns import without manual config.
const CLIENT_ALIASES = {
  customer: 'customer', customername: 'customer', account: 'customer', accountname: 'customer', client: 'customer', clientname: 'customer',
  lineid: 'line_id', line: 'line_id', invoiceid: 'line_id', invoicenumber: 'line_id', invoiceno: 'line_id', reference: 'line_id', ref: 'line_id',
  type: 'type', leakagetype: 'type', category: 'type', issuetype: 'type',
  expected: 'expected', expectedamount: 'expected', contractamount: 'expected', shouldbe: 'expected', entitled: 'expected', entitledamount: 'expected',
  actual: 'actual', actualamount: 'actual', invoiceamount: 'actual', billed: 'actual', billedamount: 'actual', invoiced: 'actual',
  currency: 'currency', ccy: 'currency', currencycode: 'currency',
  confidence: 'confidence', conf: 'confidence', agedays: 'age_days', age: 'age_days', daysoutstanding: 'age_days', dayssinceinvoice: 'age_days',
  contractstrength: 'contract_strength', strength: 'contract_strength', field: 'field', name: 'name', description: 'name', note: 'name', notes: 'name',
};
export function suggestMappingFromCsv(csv) {
  const firstLine = (csv || String.fromCharCode()).split(String.fromCharCode(10))[0] || String.fromCharCode();
  const headers = firstLine.split(String.fromCharCode(44));
  const mapping = {};
  const targets = {};
  for (const h of headers) {
    const raw = h.trim();
    const norm = raw.toLowerCase().split(String.fromCharCode()).filter((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')).join(String.fromCharCode());
    const canonical = CLIENT_ALIASES[norm];
    if (canonical && !targets[canonical] && raw !== canonical) { mapping[raw] = canonical; targets[canonical] = true; }
  }
  return Object.keys(mapping).length > 0 ? mapping : undefined;
}

export function importRunsHTML(runs) {
  const list = runs || [];
  if (list.length === 0) return '<p class="conf">No past imports yet.</p>';
  const rows = list.map(function (r) {
    const amt = ((r.recoverableMinor || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '<tr><td>' + (r.at || '').slice(0, 10) + '</td><td>' + (r.customers || 0) + '</td><td>' + (r.currency || 'GBP') + ' ' + amt + '</td><td>' + (r.rowsAccepted || 0) + '/' + ((r.rowsAccepted || 0) + (r.rowsRejected || 0)) + '</td></tr>';
  }).join('');
  return '<h3>Past imports</h3><table data-testid="import-runs"><thead><tr><th>Date</th><th>Customers</th><th>Recoverable</th><th>Rows</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

export function importPanelHTML() {
  return '<h2>Import your billing data</h2>'
    + '<p class="conf">Paste CSV with columns: <b>customer, line_id, type, expected, actual, currency</b> (optional: confidence, age_days, contract_strength, field, name). We auto-map common header names like Invoice Amount or Account.</p>'
    + '<p><button data-testid="import-template" class="btn">Download CSV template</button></p>'
    + '<p><label class="btn">Choose CSV file<input data-testid="import-file" type="file" accept=".csv,text/csv" style="display:none"></label> <span data-testid="import-filename" class="conf"></span></p>'
    + '<textarea data-testid="import-text" rows="10" style="width:100%;font-family:monospace;font-size:13px" placeholder="customer,line_id,type,expected,actual,currency&#10;Acme,INV-1,price_changed,12000,10800,GBP"></textarea>'
    + '<p><button data-testid="import-run" class="btn primary">Find my recoverable revenue</button></p>';
}

// ---- DOM wiring (only runs in a browser/jsdom with document present) ----
export function mount(doc) {
  const state = { workIQ: true, activeId: null, decisions: {} };

  const listEl = doc.querySelector('[data-testid="case-list"]');
  const inspectorEl = doc.querySelector('[data-testid="inspector"]');
  const toggleEl = doc.querySelector('[data-testid="workiq-toggle"]');
  const recallEl = doc.getElementById('recall-bar');
  const modeEl = doc.querySelector('[data-testid="mode-pill"]');

  function renderQueue() {
    recallEl.innerHTML = recallBarHTML(state.workIQ);
    const cases = visibleCases(state.workIQ);
    listEl.innerHTML = cases.map((c) => caseCardHTML(c, state.activeId)).join('');
    listEl.querySelectorAll('[data-case-id]').forEach((el) => {
      el.addEventListener('click', () => {
        state.activeId = el.getAttribute('data-case-id');
        render();
      });
    });
  }

  function activeCase() {
    return visibleCases(state.workIQ).find((c) => c.id === state.activeId) || null;
  }

  function renderInspector() {
    const c = activeCase();
    inspectorEl.innerHTML = inspectorHTML(c, c ? state.decisions[c.id] : undefined) + (c ? cfoCenterHTML(state.decisions) : '');
    const approve = inspectorEl.querySelector('[data-testid="approve-btn"]');
    const reject = inspectorEl.querySelector('[data-testid="reject-btn"]');
    if (approve) approve.addEventListener('click', () => { state.decisions[state.activeId] = 'approved'; render(); });
    if (reject) reject.addEventListener('click', () => { state.decisions[state.activeId] = 'rejected'; render(); });
  }

  function render() { renderQueue(); renderInspector(); }

  toggleEl.addEventListener('change', () => {
    state.workIQ = toggleEl.checked;
    modeEl.textContent = state.workIQ ? '● LIVE' : '● LIVE (Work IQ disabled)';
    // if the active case is now hidden, clear it
    if (!activeCase()) state.activeId = null;
    render();
  });

  render();
  return { state, render };
}

/**
 * Live mount: hydrate the queue/inspector from the real API when it is reachable. Decisions are
 * POSTed to the backend (audited server-side). Falls back to fixture `mount` when the API is down,
 * so the UI always works. The pure render functions above are reused verbatim.
 */
export async function mountLive(doc, deps) {
  const { createClient, probe } = deps.api;
  const baseUrl = deps.baseUrl || '';
  const userId = deps.userId || 'cfo';
  const reachable = await probe(baseUrl, deps.fetchImpl);
  const modeEl = doc.querySelector('[data-testid="mode-pill"]');
  if (!reachable) {
    if (modeEl) modeEl.textContent = '● DEMO (offline fixtures)';
    return mount(doc);
  }
  if (modeEl) modeEl.textContent = '● LIVE (API)';

  const client = createClient(baseUrl, userId, deps.fetchImpl);
  const state = { activeId: null, cases: [], decisions: {}, tab: 'triage', dash: null, importResult: null };
  const listEl = doc.querySelector('[data-testid="case-list"]');
  const bodyEl = doc.querySelector('[data-testid="inspector-body"]') || doc.querySelector('[data-testid="inspector"]');
  const tabTriage = doc.querySelector('[data-testid="tab-triage"]');
  const tabDash = doc.querySelector('[data-testid="tab-dashboard"]');
  const tabImport = doc.querySelector('[data-testid="tab-import"]');

  async function load() {
    const backendCases = await client.cases();
    state.cases = backendCases.map(deps.api.mapCase).sort((a, b) => b.netRecoverable - a.netRecoverable);
    for (const c of state.cases) {
      if (c.status === 'approved') state.decisions[c.id] = 'approved';
      else if (c.status === 'rejected') state.decisions[c.id] = 'rejected';
    }
  }
  async function reloadIfPossible() { try { await load(); } catch (e) { /* non-fatal */ } }
  async function loadDashboard() {
    const [headline, insights, leakageByType, roi] = await Promise.all([
      client.headline(), client.insights(), client.leakageByType(),
      client.roi({ annualPlatformCostMinor: 15000000, analystHoursSavedPerMonth: 40, analystHourlyCostMinor: 7500 }),
    ]);
    state.dash = { headline, insights, leakageByType, roi };
  }
  function activeCase() { return state.cases.find((c) => c.id === state.activeId) || null; }
  function renderQueue() {
    listEl.innerHTML = state.cases.map((c) => caseCardHTML(c, state.activeId)).join('');
    listEl.querySelectorAll('[data-case-id]').forEach((el) => {
      el.addEventListener('click', () => { state.activeId = el.getAttribute('data-case-id'); state.tab = 'triage'; render(); });
    });
  }
  function renderBody() {
    if (state.tab === 'import') {
      if (state.importResult) {
        bodyEl.innerHTML = importResultHTML(state.importResult) + '<p><button data-testid="import-again" class="btn">Import another file</button></p>';
        const again = bodyEl.querySelector('[data-testid="import-again"]');
        if (again) again.addEventListener('click', () => { state.importResult = null; render(); });
        return;
      }
      bodyEl.innerHTML = importPanelHTML();
      const runsHost = doc.createElement('div');
      runsHost.setAttribute('data-testid', 'import-runs-host');
      bodyEl.appendChild(runsHost);
      (async () => { try { const rr = await client.importRuns(); runsHost.innerHTML = importRunsHTML(rr.runs || []); } catch (e) { /* non-fatal */ } })();
      const tmpl = bodyEl.querySelector('[data-testid="import-template"]');
      if (tmpl) tmpl.addEventListener('click', async () => {
        try {
          const r = await client.importTemplate();
          const blob = new Blob([r.template], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a'); a.href = url; a.download = 'revenuetwin-template.csv'; a.click();
          URL.revokeObjectURL(url);
        } catch (e) { /* non-fatal */ }
      });
      const fileInput = bodyEl.querySelector('[data-testid="import-file"]');
      const fileName = bodyEl.querySelector('[data-testid="import-filename"]');
      if (fileInput) fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        if (fileName) fileName.textContent = f.name;
        const text = typeof f.text === 'function' ? await f.text() : await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result || String.fromCharCode())); rd.readAsText(f); });
        const taEl = bodyEl.querySelector('[data-testid="import-text"]');
        if (taEl) taEl.value = String(text || String.fromCharCode());
      });
      const run = bodyEl.querySelector('[data-testid="import-run"]');
      const ta = bodyEl.querySelector('[data-testid="import-text"]');
      if (run && ta) run.addEventListener('click', async () => {
        const csv = ta.value || String.fromCharCode();
        if (!csv.trim()) return;
        const mapping = suggestMappingFromCsv(csv);
        try { state.importResult = await client.importCsv(csv, mapping); }
        catch (e) { state.importResult = { totalRecoverableFormatted: 'import failed', summaries: [], rejects: [{ row: 0, reason: String(e && e.message || e) }] }; }
        await reloadIfPossible();
        render();
      });
      return;
    }
    if (state.tab === 'dashboard') {
      bodyEl.innerHTML = dashboardHTML(state.dash || {});
      return;
    }
    const c = activeCase();
    bodyEl.innerHTML = inspectorHTML(c, c ? state.decisions[c.id] : undefined) + (c ? cfoCenterHTML(state.decisions) : '');
    const approve = bodyEl.querySelector('[data-testid="approve-btn"]');
    const reject = bodyEl.querySelector('[data-testid="reject-btn"]');
    if (approve) approve.addEventListener('click', async () => { await client.decide(state.activeId, 'approve'); state.decisions[state.activeId] = 'approved'; render(); });
    if (reject) reject.addEventListener('click', async () => { await client.decide(state.activeId, 'reject'); state.decisions[state.activeId] = 'rejected'; render(); });
  }

  function render() { renderQueue(); renderBody(); }

  if (tabTriage) tabTriage.addEventListener('click', () => { state.tab = 'triage'; render(); });
  if (tabDash) tabDash.addEventListener('click', async () => { state.tab = 'dashboard'; if (!state.dash) await loadDashboard(); render(); });
  if (tabImport) tabImport.addEventListener('click', () => { state.tab = 'import'; render(); });

  await load();
  render();
  return { state, render, loadDashboard, reload: async () => { await load(); render(); } };
}
