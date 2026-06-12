/**
 * Work IQ extraction engine (S15).
 *
 * Turns unstructured commercial text (meeting transcripts, emails, QBR notes) into the STRUCTURED
 * intent signal the deterministic engine consumes: { upliftPercent?, confidence, intentType }.
 *
 * Two-layer design:
 *  - `IntentExtractor` is the pluggable interface. Production wires an LLM-backed extractor.
 *  - `RuleBasedExtractor` is a deterministic, dependency-free implementation used for pilots,
 *    the offline demo, and tests — and as a guardrail/fallback in production.
 *
 * SAFETY: extracted text is DATA, never instructions. The extractor produces a typed signal;
 * it never executes anything in the text. Confidence is bounded [0,1]. Downstream, Work IQ only
 * acts on the structured fields (already tested in workiq + adversarial suites).
 */
import type { CommercialIntentEvent } from '../core/model.ts';

export class ExtractionError extends Error {
  constructor(message: string) { super(message); this.name = 'ExtractionError'; }
}

/** Raw unstructured input to extract from. */
export interface IntentDocument {
  readonly id: string;
  readonly customerId: string;
  readonly source: 'email' | 'meeting' | 'qbr';
  readonly capturedAt: string;
  readonly text: string;
  readonly deepLink: string;
}

/** Structured signal produced by extraction (pre-event). */
export interface ExtractedSignal {
  readonly intentType: string;
  readonly upliftPercent?: number;
  readonly confidence: number;
  readonly extractedSpan: string;
}

/** Pluggable extractor. Production: LLM-backed. Default: RuleBasedExtractor. */
export interface IntentExtractor {
  extract(doc: IntentDocument): Promise<ExtractedSignal | null>;
}

/** Clamp confidence to [0,1]; reject NaN. */
export function clampConfidence(c: number): number {
  if (Number.isNaN(c)) throw new ExtractionError('confidence is NaN');
  if (c < 0) return 0;
  if (c > 1) return 1;
  return c;
}

/**
 * Deterministic rule-based extractor.
 * Detects an uplift commitment of the form "<n>% uplift|increase|raise" and assigns a
 * confidence based on linguistic certainty markers. Injection-safe: it only ever reads,
 * pattern-matches, and emits a typed signal.
 */
export class RuleBasedExtractor implements IntentExtractor {
  // capture a percentage near an uplift keyword (global: scan all candidates)
  private static readonly UPLIFT_RE = /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:uplift|increase|raise|bump)/gi;
  private static readonly COMMIT_MARKERS = ['agreed', 'confirmed', 'committed', 'will', 'approved', 'signed off'];
  private static readonly HEDGE_MARKERS = ['maybe', 'might', 'possibly', 'considering', 'thinking about', 'could'];

  async extract(doc: IntentDocument): Promise<ExtractedSignal | null> {
    const text = doc.text;
    const lower = text.toLowerCase();

    // base confidence from linguistic certainty markers, computed once for the document
    let confidence = 0.5;
    if (RuleBasedExtractor.COMMIT_MARKERS.some((w) => lower.includes(w))) confidence += 0.35;
    if (RuleBasedExtractor.HEDGE_MARKERS.some((w) => lower.includes(w))) confidence -= 0.3;
    confidence = clampConfidence(confidence);

    // scan ALL uplift candidates; keep the first that falls in the valid 1..100 range so a
    // malicious out-of-range leading number cannot suppress a legitimate later signal.
    const re = new RegExp(RuleBasedExtractor.UPLIFT_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const pct = Number(m[1]);
      if (Number.isFinite(pct) && pct > 0 && pct <= 100) {
        const idx = m.index;
        const span = text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + m[0].length + 20)).trim();
        return { intentType: 'uplift', upliftPercent: pct, confidence, extractedSpan: span };
      }
    }
    return null;
  }
}

/**
 * Run an extractor over a document and assemble a canonical CommercialIntentEvent.
 * Returns null when nothing extractable is found. Enforces confidence bounds and a minimum
 * threshold so noise below the bar never becomes an event.
 */
export async function extractIntentEvent(
  extractor: IntentExtractor,
  doc: IntentDocument,
  minConfidence = 0,
): Promise<CommercialIntentEvent | null> {
  const signal = await extractor.extract(doc);
  if (signal === null) return null;
  const confidence = clampConfidence(signal.confidence);
  if (confidence < minConfidence) return null;
  return {
    id: doc.id,
    customerId: doc.customerId,
    source: doc.source,
    capturedAt: doc.capturedAt,
    extractedSpan: signal.extractedSpan,
    intentType: signal.intentType,
    ...(signal.upliftPercent !== undefined ? { upliftPercent: signal.upliftPercent } : {}),
    confidence,
    deepLink: doc.deepLink,
  };
}

/** Batch extraction: returns events for documents that yielded a signal at/above threshold. */
export async function extractBatch(
  extractor: IntentExtractor,
  docs: IntentDocument[],
  minConfidence = 0,
): Promise<CommercialIntentEvent[]> {
  const out: CommercialIntentEvent[] = [];
  for (const d of docs) {
    const ev = await extractIntentEvent(extractor, d, minConfidence);
    if (ev) out.push(ev);
  }
  return out;
}
