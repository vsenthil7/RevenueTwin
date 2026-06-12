/**
 * Identity & RBAC (S17).
 *
 * Authorization model on top of the existing `Principal`/`canRead`/SoD foundation. AuthN is
 * delegated to the enterprise IdP (SAML/OIDC); this module models WHO-CAN-DO-WHAT once a user
 * is authenticated: roles, granular permissions, customer scoping, and a SCIM-style user store.
 *
 * Permissions are deny-by-default. A capability check must find an explicit grant.
 */
export class AuthzError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthzError'; }
}

/** Granular permissions. Extend as features grow. */
export type Permission =
  | 'case:read' | 'case:triage' | 'case:approve' | 'case:reject'
  | 'remediation:propose' | 'remediation:reverse'
  | 'billing:writeback' | 'billing:void'
  | 'audit:read' | 'admin:manage_users' | 'admin:manage_policy'
  | 'connector:manage' | 'dispute:manage' | 'collections:manage';

export type RoleName = 'cfo' | 'controller' | 'revops' | 'legal' | 'collections' | 'auditor' | 'admin';

/** Default role → permission grants. Deny-by-default; only listed permissions are granted. */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  cfo: ['case:read', 'case:triage', 'case:approve', 'case:reject', 'billing:writeback', 'billing:void', 'audit:read', 'dispute:manage', 'collections:manage'],
  controller: ['case:read', 'case:triage', 'case:approve', 'case:reject', 'billing:writeback', 'audit:read'],
  revops: ['case:read', 'case:triage', 'remediation:propose'],
  legal: ['case:read', 'dispute:manage', 'audit:read'],
  collections: ['case:read', 'collections:manage'],
  auditor: ['case:read', 'audit:read'],
  admin: ['admin:manage_users', 'admin:manage_policy', 'connector:manage', 'audit:read'],
};

export interface User {
  readonly id: string;
  readonly email: string;
  readonly roles: RoleName[];
  readonly allowedCustomers: string[] | '*';
  readonly active: boolean;
}

/** A resolved, authenticated principal with its effective permission set. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly roles: RoleName[];
  readonly permissions: Set<Permission>;
  readonly allowedCustomers: string[] | '*';
}

/** Compute the union of permissions granted by a set of roles. */
export function effectivePermissions(roles: RoleName[]): Set<Permission> {
  const perms = new Set<Permission>();
  for (const r of roles) {
    const granted = ROLE_PERMISSIONS[r];
    if (granted === undefined) throw new AuthzError(`Unknown role '${r}'`);
    for (const p of granted) perms.add(p);
  }
  return perms;
}

/** Build an authenticated principal from a user (post-IdP authentication). */
export function principalFromUser(user: User): AuthenticatedPrincipal {
  if (!user.active) throw new AuthzError(`User ${user.id} is inactive`);
  if (user.roles.length === 0) throw new AuthzError(`User ${user.id} has no roles`);
  return {
    userId: user.id,
    roles: user.roles,
    permissions: effectivePermissions(user.roles),
    allowedCustomers: user.allowedCustomers,
  };
}

/** Capability check (deny-by-default). */
export function can(principal: AuthenticatedPrincipal, permission: Permission): boolean {
  return principal.permissions.has(permission);
}

/** Enforce a capability; throw if absent. */
export function require_(principal: AuthenticatedPrincipal, permission: Permission): void {
  if (!can(principal, permission)) {
    throw new AuthzError(`Principal ${principal.userId} lacks permission '${permission}'`);
  }
}

/** Customer-scope check, mirroring platform.canRead but on the authenticated principal. */
export function canAccessCustomer(principal: AuthenticatedPrincipal, customerId: string): boolean {
  if (principal.allowedCustomers === '*') return true;
  return principal.allowedCustomers.includes(customerId);
}

/**
 * SCIM-style user directory. Production syncs from the IdP; in-memory here. Supports the
 * lifecycle operations an enterprise expects: provision, deactivate, role assignment.
 */
export class UserStore {
  private users = new Map<string, User>();

  provision(user: User): void {
    if (this.users.has(user.id)) throw new AuthzError(`User ${user.id} already exists`);
    this.users.set(user.id, user);
  }

  get(id: string): User {
    const u = this.users.get(id);
    if (!u) throw new AuthzError(`User ${id} not found`);
    return u;
  }

  deactivate(id: string): void {
    const u = this.get(id);
    this.users.set(id, { ...u, active: false });
  }

  assignRoles(id: string, roles: RoleName[]): void {
    const u = this.get(id);
    this.users.set(id, { ...u, roles });
  }

  setCustomerScope(id: string, allowedCustomers: string[] | '*'): void {
    const u = this.get(id);
    this.users.set(id, { ...u, allowedCustomers });
  }

  list(): User[] {
    return [...this.users.values()];
  }

  authenticate(id: string): AuthenticatedPrincipal {
    return principalFromUser(this.get(id));
  }
}
