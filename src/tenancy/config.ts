/**
 * Tenant configuration & feature entitlements (S28).
 *
 * Per-tenant settings, edition-based feature entitlements, and usage limits — the control plane
 * for a multi-tenant SaaS. Deterministic checks: a feature is available iff the tenant's edition
 * grants it (or it is explicitly overridden), and a usage action is allowed iff under its limit.
 */
export class TenancyError extends Error {
  constructor(message: string) { super(message); this.name = 'TenancyError'; }
}

export type Edition = 'assurance_core' | 'work_iq' | 'enterprise_os';

export type Feature =
  | 'reconciliation' | 'web_control_room' | 'audit'
  | 'work_iq' | 'intent_extraction' | 'blind_vs_sighted'
  | 'sox_controls' | 'dual_approval' | 'legal_hold' | 'period_close'
  | 'mobile_approvals' | 'connectors' | 'webhooks' | 'billing_writeback'
  | 'forecasting' | 'anomaly_detection' | 'multi_currency' | 'bulk_ops';

/** Edition → granted features (cumulative tiers). */
export const EDITION_FEATURES: Record<Edition, Feature[]> = {
  assurance_core: ['reconciliation', 'web_control_room', 'audit', 'bulk_ops'],
  work_iq: ['reconciliation', 'web_control_room', 'audit', 'bulk_ops',
    'work_iq', 'intent_extraction', 'blind_vs_sighted', 'anomaly_detection'],
  enterprise_os: ['reconciliation', 'web_control_room', 'audit', 'bulk_ops',
    'work_iq', 'intent_extraction', 'blind_vs_sighted', 'anomaly_detection',
    'sox_controls', 'dual_approval', 'legal_hold', 'period_close',
    'mobile_approvals', 'connectors', 'webhooks', 'billing_writeback',
    'forecasting', 'multi_currency'],
};

export interface UsageLimits {
  readonly maxConnectors: number;
  readonly maxUsers: number;
  readonly maxCasesPerMonth: number;
}

export const EDITION_LIMITS: Record<Edition, UsageLimits> = {
  assurance_core: { maxConnectors: 3, maxUsers: 10, maxCasesPerMonth: 1_000 },
  work_iq: { maxConnectors: 6, maxUsers: 50, maxCasesPerMonth: 10_000 },
  enterprise_os: { maxConnectors: 50, maxUsers: 1_000, maxCasesPerMonth: 1_000_000 },
};

export interface TenantConfig {
  readonly tenantId: string;
  readonly edition: Edition;
  /** explicit feature overrides (e.g. a pilot of a higher-tier feature). */
  readonly featureOverrides: Partial<Record<Feature, boolean>>;
  /** reporting currency for consolidation. */
  readonly reportingCurrency: string;
  /** tunable settings. */
  readonly settings: Record<string, number | string | boolean>;
}

export class TenantRegistry {
  private tenants = new Map<string, TenantConfig>();
  private usage = new Map<string, { connectors: number; users: number; casesThisMonth: number }>();

  register(config: TenantConfig): void {
    if (this.tenants.has(config.tenantId)) throw new TenancyError(`Tenant ${config.tenantId} exists`);
    this.tenants.set(config.tenantId, config);
    this.usage.set(config.tenantId, { connectors: 0, users: 0, casesThisMonth: 0 });
  }

  get(tenantId: string): TenantConfig {
    const t = this.tenants.get(tenantId);
    if (!t) throw new TenancyError(`Tenant ${tenantId} not found`);
    return t;
  }

  /** Is a feature available to a tenant? Override wins; otherwise edition grant. */
  hasFeature(tenantId: string, feature: Feature): boolean {
    const t = this.get(tenantId);
    const override = t.featureOverrides[feature];
    if (override !== undefined) return override;
    return EDITION_FEATURES[t.edition].includes(feature);
  }

  /** Enforce a feature; throw when not entitled. */
  requireFeature(tenantId: string, feature: Feature): void {
    if (!this.hasFeature(tenantId, feature)) {
      throw new TenancyError(`Tenant ${tenantId} not entitled to feature '${feature}'`);
    }
  }

  limits(tenantId: string): UsageLimits {
    return EDITION_LIMITS[this.get(tenantId).edition];
  }

  /** Attempt to consume a unit of a metered resource; returns false if it would exceed the limit. */
  consume(tenantId: string, resource: 'connectors' | 'users' | 'casesThisMonth'): boolean {
    const t = this.get(tenantId);
    const u = this.usage.get(tenantId)!;
    const limits = EDITION_LIMITS[t.edition];
    const limitMap: Record<typeof resource, number> = {
      connectors: limits.maxConnectors,
      users: limits.maxUsers,
      casesThisMonth: limits.maxCasesPerMonth,
    };
    if (u[resource] + 1 > limitMap[resource]) return false;
    u[resource] += 1;
    return true;
  }

  usageOf(tenantId: string): { connectors: number; users: number; casesThisMonth: number } {
    this.get(tenantId);
    return { ...this.usage.get(tenantId)! };
  }

  /** Reset the monthly case counter (called by a scheduler at period boundaries). */
  resetMonthly(tenantId: string): void {
    const u = this.usage.get(tenantId);
    if (!u) throw new TenancyError(`Tenant ${tenantId} not found`);
    u.casesThisMonth = 0;
  }

  setting<T extends number | string | boolean>(tenantId: string, key: string, fallback: T): T {
    const v = this.get(tenantId).settings[key];
    return (v === undefined ? fallback : v) as T;
  }
}
