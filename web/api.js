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
    importCsv: (csv) => post('/api/import', { csv }),

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
