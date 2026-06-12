/**
 * Production webhook delivery (S34).
 *
 * Hardened outbound events: HMAC-signed payloads (so receivers verify authenticity), retry with
 * backoff on transient failure, and a dead-letter queue for exhausted deliveries. Deterministic
 * and transport-pluggable (the `Transport` is injected; tests use a fake).
 */
import { createHmac } from 'node:crypto';

export class WebhookDeliveryError extends Error {
  constructor(message: string) { super(message); this.name = 'WebhookDeliveryError'; }
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly secret: string;
  readonly maxAttempts: number;
}

export interface OutboundEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

/** Sign a payload body with the endpoint secret (HMAC-SHA256, hex). */
export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Verify a signature (constant-time-ish via hash equality). */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  return signPayload(secret, body) === signature;
}

export interface DeliveryAttempt {
  readonly endpointId: string;
  readonly eventId: string;
  readonly attempt: number;
  readonly at: string;
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly error?: string;
}

/** Pluggable transport. Returns an HTTP-like status; throws for network errors. */
export interface Transport {
  send(url: string, body: string, signature: string): Promise<{ statusCode: number }>;
}

export class WebhookDispatcherV2 {
  private attempts: DeliveryAttempt[] = [];
  private deadLetters: { endpoint: WebhookEndpoint; event: OutboundEvent; lastError: string }[] = [];

  constructor(
    private transport: Transport,
    private clock: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Attempt delivery with retries. A 2xx is success. Non-2xx or thrown errors are retried up to
   * maxAttempts; exhaustion moves the event to the dead-letter queue. Returns the attempt list.
   */
  async deliver(endpoint: WebhookEndpoint, event: OutboundEvent): Promise<DeliveryAttempt[]> {
    if (endpoint.maxAttempts < 1) throw new WebhookDeliveryError('maxAttempts must be >= 1');
    const body = JSON.stringify({ id: event.id, type: event.type, payload: event.payload, createdAt: event.createdAt });
    const signature = signPayload(endpoint.secret, body);
    const made: DeliveryAttempt[] = [];

    for (let attempt = 1; attempt <= endpoint.maxAttempts; attempt++) {
      const at = this.clock();
      let record: DeliveryAttempt;
      try {
        const res = await this.transport.send(endpoint.url, body, signature);
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        record = { endpointId: endpoint.id, eventId: event.id, attempt, at, ok, statusCode: res.statusCode };
        made.push(record);
        this.attempts.push(record);
        if (ok) return made;
      } catch (e) {
        record = { endpointId: endpoint.id, eventId: event.id, attempt, at, ok: false, error: e instanceof Error ? e.message : `${e}` };
        made.push(record);
        this.attempts.push(record);
      }
    }
    // exhausted -> dead letter
    const last = made[made.length - 1]!;
    this.deadLetters.push({
      endpoint, event,
      lastError: last.error ?? `status ${last.statusCode}`,
    });
    return made;
  }

  /** Re-attempt all dead letters (e.g. after fixing an endpoint). Clears those that now succeed. */
  async redriveDeadLetters(): Promise<{ redriven: number; stillFailing: number }> {
    const queue = [...this.deadLetters];
    this.deadLetters = [];
    let redriven = 0;
    let stillFailing = 0;
    for (const item of queue) {
      const attempts = await this.deliver(item.endpoint, item.event);
      if (attempts[attempts.length - 1]!.ok) redriven += 1;
      else stillFailing += 1;
    }
    return { redriven, stillFailing };
  }

  attemptHistory(eventId?: string): DeliveryAttempt[] {
    return eventId === undefined ? [...this.attempts] : this.attempts.filter((a) => a.eventId === eventId);
  }

  deadLetterCount(): number {
    return this.deadLetters.length;
  }
}
