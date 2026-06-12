/**
 * Connector platform (S53 — Block R foundation).
 *
 * The integration surface: a typed registry of source connectors (Salesforce, Stripe, DocuSign,
 * M365 Graph, …), each declaring a category and reporting health/mode, plus webhook subscription
 * records. Connectors only READ + NORMALIZE upstream; they never do money math or write-back —
 * that boundary keeps untrusted external data from ever steering an action. This module is the
 * registry + status model; the ingestion mechanics live in `connectors/`.
 */

/** What kind of system a connector pulls from. */
export type ConnectorCategory =
  | 'crm'
  | 'billing'
  | 'erp'
  | 'cpq'
  | 'contracts'
  | 'communications'
  | 'data_warehouse';

/** Operational health of a connector. */
export type ConnectorHealth = 'healthy' | 'degraded' | 'unavailable';

/** Live vs fixture (replay) mode — fixture mode powers the offline demo. */
export type ConnectorMode = 'live' | 'fixture';

export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformError';
  }
}

/** A registered connector's descriptor. */
export interface ConnectorDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectorCategory;
  health: ConnectorHealth;
  mode: ConnectorMode;
}

/** A webhook subscription (delivery is handled by `webhooks/`). */
export interface WebhookSubscription {
  readonly id: string;
  readonly event: string;
  readonly url: string;
  active: boolean;
}

/** The platform registry: register connectors, report health, manage webhook subscriptions. */
export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDescriptor>();
  private webhooks = new Map<string, WebhookSubscription>();

  /** Register a connector. Throws on duplicate id. */
  register(d: ConnectorDescriptor): void {
    if (this.connectors.has(d.id)) throw new PlatformError(`Connector ${d.id} already registered`);
    this.connectors.set(d.id, { ...d });
  }

  /** Update a connector's health. */
  setHealth(id: string, health: ConnectorHealth): void {
    this.require(id).health = health;
  }

  /** Switch a connector between live and fixture mode. */
  setMode(id: string, mode: ConnectorMode): void {
    this.require(id).mode = mode;
  }

  /** A connector descriptor, or null. */
  get(id: string): ConnectorDescriptor | null {
    const c = this.connectors.get(id);
    return c ? { ...c } : null;
  }

  /** All registered connectors (defensive copies). */
  list(): ConnectorDescriptor[] {
    return [...this.connectors.values()].map((c) => ({ ...c }));
  }

  /** Connectors currently in a given health state. */
  byHealth(health: ConnectorHealth): ConnectorDescriptor[] {
    return this.list().filter((c) => c.health === health);
  }

  /** True iff every registered connector is healthy. */
  allHealthy(): boolean {
    return this.list().every((c) => c.health === 'healthy');
  }

  /** Subscribe a webhook. Throws on duplicate id. */
  subscribe(sub: WebhookSubscription): void {
    if (this.webhooks.has(sub.id)) throw new PlatformError(`Webhook ${sub.id} already exists`);
    this.webhooks.set(sub.id, { ...sub });
  }

  /** Deactivate a webhook subscription (idempotent). */
  unsubscribe(id: string): void {
    const w = this.webhooks.get(id);
    if (w) w.active = false;
  }

  /** Active webhook subscriptions for an event. */
  subscribersFor(event: string): WebhookSubscription[] {
    return [...this.webhooks.values()].filter((w) => w.active && w.event === event).map((w) => ({ ...w }));
  }

  private require(id: string): ConnectorDescriptor {
    const c = this.connectors.get(id);
    if (!c) throw new PlatformError(`Unknown connector ${id}`);
    return c;
  }
}
