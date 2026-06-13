import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WebhookDeliveryError, signPayload, verifySignature, WebhookDispatcherV2,
  type WebhookEndpoint, type OutboundEvent, type Transport,
} from '../../src/webhooks/delivery.ts';

function endpoint(over: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return { id: 'ep1', url: 'https://x/hook', secret: 's3cr3t', maxAttempts: 3, ...over };
}
function event(over: Partial<OutboundEvent> = {}): OutboundEvent {
  return { id: 'e1', type: 'case.created', payload: { caseId: 'c1' }, createdAt: '2026-01-01T00:00:00Z', ...over };
}
function clockSeq(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

/** Transport that returns a fixed status, or a script of statuses/throws. */
function scriptedTransport(script: (number | 'throw')[]): Transport {
  let i = 0;
  return {
    async send() {
      const s = script[Math.min(i++, script.length - 1)]!;
      if (s === 'throw') throw new Error('network down');
      return { statusCode: s };
    },
  };
}

test('signPayload + verifySignature round-trip', () => {
  const sig = signPayload('secret', 'body');
  assert.equal(verifySignature('secret', 'body', sig), true);
  assert.equal(verifySignature('secret', 'body', 'wrong'), false);
  assert.equal(verifySignature('other', 'body', sig), false);
});

test('deliver succeeds on a 2xx first attempt', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([200]), clockSeq(['t0']));
  const attempts = await d.deliver(endpoint(), event());
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]!.ok, true);
  assert.equal(attempts[0]!.statusCode, 200);
  assert.equal(d.deadLetterCount(), 0);
});

test('deliver with default clock stamps ISO timestamps', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([200]));
  const attempts = await d.deliver(endpoint(), event());
  assert.match(attempts[0]!.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('deliver retries non-2xx then succeeds', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([500, 200]), clockSeq(['t0', 't1']));
  const attempts = await d.deliver(endpoint(), event());
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]!.ok, false);
  assert.equal(attempts[1]!.ok, true);
});

test('deliver retries thrown network errors then dead-letters on exhaustion', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport(['throw', 'throw', 'throw']), clockSeq(['t0', 't1', 't2']));
  const attempts = await d.deliver(endpoint({ maxAttempts: 3 }), event());
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every((a) => a.ok === false));
  assert.equal(attempts[0]!.error, 'network down');
  assert.equal(d.deadLetterCount(), 1);
});

test('deliver dead-letters after non-2xx exhaustion (lastError from status)', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([503]), clockSeq(['t0']));
  await d.deliver(endpoint({ maxAttempts: 1 }), event());
  assert.equal(d.deadLetterCount(), 1);
});

test('deliver rejects maxAttempts < 1', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([200]));
  await assert.rejects(() => d.deliver(endpoint({ maxAttempts: 0 }), event()), WebhookDeliveryError);
});

test('redriveDeadLetters retries the queue, counting redriven vs still failing', async () => {
  // first event always fails (dead-letters), then redrive: transport now returns 200
  const transport = scriptedTransport(['throw', 'throw', 200]);
  const d = new WebhookDispatcherV2(transport, clockSeq(['t0', 't1', 't2', 't3']));
  await d.deliver(endpoint({ maxAttempts: 2 }), event());
  assert.equal(d.deadLetterCount(), 1);
  const result = await d.redriveDeadLetters();
  assert.equal(result.redriven, 1);
  assert.equal(result.stillFailing, 0);
  assert.equal(d.deadLetterCount(), 0);
});

test('redriveDeadLetters keeps still-failing items counted', async () => {
  const transport = scriptedTransport(['throw']); // always throws
  const d = new WebhookDispatcherV2(transport, clockSeq(['t0', 't1', 't2', 't3', 't4']));
  await d.deliver(endpoint({ maxAttempts: 1 }), event());
  const result = await d.redriveDeadLetters();
  assert.equal(result.stillFailing, 1);
  assert.equal(result.redriven, 0);
});

test('deliver stringifies a non-Error throwable', async () => {
  const transport: Transport = { async send() { throw 'raw-string-failure'; } };
  const d = new WebhookDispatcherV2(transport, clockSeq(['t0']));
  const attempts = await d.deliver(endpoint({ maxAttempts: 1 }), event());
  assert.equal(attempts[0]!.error, 'raw-string-failure');
});

test('attemptHistory filters by eventId', async () => {
  const d = new WebhookDispatcherV2(scriptedTransport([200]), clockSeq(['t0', 't1']));
  await d.deliver(endpoint(), event({ id: 'a' }));
  await d.deliver(endpoint(), event({ id: 'b' }));
  assert.equal(d.attemptHistory().length, 2);
  assert.equal(d.attemptHistory('a').length, 1);
});
