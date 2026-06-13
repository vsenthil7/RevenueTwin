import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtractionError, clampConfidence, RuleBasedExtractor,
  extractIntentEvent, extractBatch,
  type IntentDocument, type IntentExtractor, type ExtractedSignal,
} from '../../src/intent/extraction.ts';

function doc(over: Partial<IntentDocument> = {}): IntentDocument {
  return {
    id: 'd1', customerId: 'acme', source: 'qbr', capturedAt: '2026-01-01',
    text: 'We agreed a 10% uplift next cycle.', deepLink: 'https://x/1', ...over,
  };
}

test('clampConfidence clamps and rejects NaN', () => {
  assert.equal(clampConfidence(0.5), 0.5);
  assert.equal(clampConfidence(-1), 0);
  assert.equal(clampConfidence(2), 1);
  assert.throws(() => clampConfidence(Number.NaN), ExtractionError);
});

test('rule extractor finds an uplift with commitment confidence boost', async () => {
  const ex = new RuleBasedExtractor();
  const s = await ex.extract(doc());
  assert.ok(s);
  assert.equal(s!.upliftPercent, 10);
  assert.equal(s!.intentType, 'uplift');
  assert.ok(s!.confidence > 0.8); // base 0.5 + 0.35 commit marker
  assert.match(s!.extractedSpan, /10% uplift/);
});

test('rule extractor reduces confidence on hedge markers', async () => {
  const ex = new RuleBasedExtractor();
  const s = await ex.extract(doc({ text: 'We are maybe considering a 5% increase.' }));
  assert.ok(s);
  assert.ok(s!.confidence < 0.5); // base 0.5 - 0.3 hedge
});

test('rule extractor base confidence with neither marker', async () => {
  const ex = new RuleBasedExtractor();
  const s = await ex.extract(doc({ text: 'A 7% raise is on the table.' }));
  assert.ok(s);
  assert.equal(s!.confidence, 0.5);
});

test('rule extractor returns null when no uplift pattern', async () => {
  const ex = new RuleBasedExtractor();
  assert.equal(await ex.extract(doc({ text: 'Just a routine check-in, nothing agreed.' })), null);
});

test('rule extractor skips out-of-range percentages and keeps a valid later one', async () => {
  const ex = new RuleBasedExtractor();
  // 250% is out of range and must not suppress the valid 12% that follows
  const s = await ex.extract(doc({ text: 'Not a 250% increase obviously, but a 12% uplift was agreed.' }));
  assert.ok(s);
  assert.equal(s!.upliftPercent, 12);
});

test('rule extractor returns null when only out-of-range percentages present', async () => {
  const ex = new RuleBasedExtractor();
  assert.equal(await ex.extract(doc({ text: 'A 0% uplift and a 999% increase were mentioned.' })), null);
});

test('extractIntentEvent assembles a canonical event', async () => {
  const ev = await extractIntentEvent(new RuleBasedExtractor(), doc());
  assert.ok(ev);
  assert.equal(ev!.customerId, 'acme');
  assert.equal(ev!.upliftPercent, 10);
  assert.equal(ev!.source, 'qbr');
  assert.equal(ev!.deepLink, 'https://x/1');
});

test('extractIntentEvent returns null when extractor yields nothing', async () => {
  const none: IntentExtractor = { async extract() { return null; } };
  assert.equal(await extractIntentEvent(none, doc()), null);
});

test('extractIntentEvent drops signals below the confidence threshold', async () => {
  const weak: IntentExtractor = { async extract(): Promise<ExtractedSignal> { return { intentType: 'uplift', upliftPercent: 5, confidence: 0.4, extractedSpan: 's' }; } };
  assert.equal(await extractIntentEvent(weak, doc(), 0.7), null);
});

test('extractIntentEvent omits upliftPercent when signal lacks it', async () => {
  const noUplift: IntentExtractor = { async extract(): Promise<ExtractedSignal> { return { intentType: 'churn_risk', confidence: 0.9, extractedSpan: 's' }; } };
  const ev = await extractIntentEvent(noUplift, doc());
  assert.ok(ev);
  assert.equal('upliftPercent' in ev!, false);
  assert.equal(ev!.intentType, 'churn_risk');
});

test('extractBatch returns events only for documents that yield signals', async () => {
  const docs = [doc({ id: 'a' }), doc({ id: 'b', text: 'nothing here' }), doc({ id: 'c', text: 'agreed 8% uplift' })];
  const events = await extractBatch(new RuleBasedExtractor(), docs);
  assert.deepEqual(events.map((e) => e.id), ['a', 'c']);
});
