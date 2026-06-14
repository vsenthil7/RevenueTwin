// RevenueTwin web API client. Pure functions + thin fetch wrappers so the mapping logic is
// unit-testable in jsdom without a live server (fetch is injected).

/** Map a backend LeakageCase to the UI card/inspector shape used by app.js render functions. */
export function mapCase(backendCase) {
  const net = backendCase.findings.reduce((s, f) => s + f.netRecoverable.amount, 0);
  const gross = backendCase.findings.reduce((s, f) => s + f.grossDetected.amount, 0);
  const primary = backendCase.findings[0] || {};
  const conf = primary.confidence != null ? primary.confidence : 0;
  const mapped = {
    id: backendCase.id,
    customer: backendCase.customerId,
    type: primary.type || 'unknown',
    grossDetected: gross,
    netRecoverable: net,
    confidence: conf,
    detectedViaWorkIQ: !!backendCase.detectedViaWorkIQ,
    status: backendCase.status,
  };
  if (backendCase.detectedViaWorkIQ) {
    mapped.provenance = {
      source: 'Commercial intent (Work IQ)',
      span: primary.extractedSpan || 'Commercial commitment detected in unstructured source',
      deepLink: primary.deepLink || '#',
      whyIntent: 'Detected from unstructured commercial signal; no billing line followed.',
    };
  }
  // S72: per-finding provenance breakdown (expected vs actual vs gross vs net = decay applied).
  mapped.findings = (backendCase.findings || []).map(function (f) {
    const g = (f.grossDetected && f.grossDetected.amount) || 0;
    const nt = (f.netRecoverable && f.netRecoverable.amount) || 0;
    return {
      name: f.name || f.field || f.type || 'finding',
      type: f.type,
      expectedMinor: (f.expected && f.expected.amount) != null ? f.expected.amount : null,
      actualMinor: (f.actual && f.actual.amount) != null ? f.actual.amount : null,
      grossMinor: g,
      netMinor: nt,
      decayMinor: g - nt,
      confidence: f.confidence != null ? f.confidence : null,
    };
  });
  return mapped;
}

/** Build request headers for a given demo user. */
export function authHeaders(userId) {
  return { 'x-user-id': userId, 'Content-Type': 'application/json' };
}

/** A minimal API client bound to a base URL and a user id. fetchImpl is injectable for tests. */
export function createClient(baseUrl, userId, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const h = authHeaders(userId);
  async function get(path) {
    const res = await f(baseUrl + path, { headers: h });
    if (!res.ok) throw new Error('GET ' + path + ' -> ' + res.status);
    return res.json();
  }
  async function post(path, body) {
    const res = await f(baseUrl + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('POST ' + path + ' -> ' + res.status);
    return res.json();
  }
  return {
    health: () => get('/api/health'),
    cases: () => get('/api/cases'),
    portfolio: () => get('/api/portfolio'),
    audit: () => get('/api/audit'),
    headline: () => get('/api/headline'),
    insights: () => get('/api/insights'),
    anomalies: () => get('/api/anomalies'),
    leakageByType: () => get('/api/leakage-by-type'),
    roi: (inputs) => post('/api/roi', inputs),
    decide: (caseId, decision) => post('/api/cases/' + encodeURIComponent(caseId) + '/decision', { decision }),
    importCsv: (csv, mapping) => post('/api/import', mapping ? { csv, mapping } : { csv }),
    importTemplate: () => get('/api/import-template'),
    importRuns: () => get('/api/import-runs'),

  };
}

/** Is the API reachable? Resolves true/false, never throws. */
export async function probe(baseUrl, fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return false;
  try {
    const res = await f(baseUrl + '/api/health');
    return res.ok;
  } catch {
    return false;
  }
}
