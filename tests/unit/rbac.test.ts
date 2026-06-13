import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthzError, ROLE_PERMISSIONS, effectivePermissions, principalFromUser,
  can, require_, canAccessCustomer, UserStore,
  type User, type RoleName,
} from '../../src/identity/rbac.ts';

function user(over: Partial<User> = {}): User {
  return { id: 'u1', email: 'u1@x.com', roles: ['cfo'], allowedCustomers: '*', active: true, ...over };
}

test('effectivePermissions unions role grants', () => {
  const perms = effectivePermissions(['revops', 'legal']);
  assert.ok(perms.has('remediation:propose'));
  assert.ok(perms.has('dispute:manage'));
  assert.ok(perms.has('case:read'));
});

test('effectivePermissions throws on unknown role', () => {
  assert.throws(() => effectivePermissions(['nope' as RoleName]), AuthzError);
});

test('every role in ROLE_PERMISSIONS resolves', () => {
  for (const role of Object.keys(ROLE_PERMISSIONS) as RoleName[]) {
    assert.ok(effectivePermissions([role]).size > 0);
  }
});

test('principalFromUser builds a principal with permissions', () => {
  const p = principalFromUser(user({ roles: ['controller'] }));
  assert.equal(p.userId, 'u1');
  assert.ok(p.permissions.has('billing:writeback'));
  assert.equal(p.allowedCustomers, '*');
});

test('principalFromUser rejects inactive user', () => {
  assert.throws(() => principalFromUser(user({ active: false })), AuthzError);
});

test('principalFromUser rejects user with no roles', () => {
  assert.throws(() => principalFromUser(user({ roles: [] })), AuthzError);
});

test('can is deny-by-default', () => {
  const p = principalFromUser(user({ roles: ['auditor'] }));
  assert.equal(can(p, 'audit:read'), true);
  assert.equal(can(p, 'billing:writeback'), false);
});

test('require_ throws when permission absent, passes when present', () => {
  const p = principalFromUser(user({ roles: ['auditor'] }));
  assert.doesNotThrow(() => require_(p, 'audit:read'));
  assert.throws(() => require_(p, 'case:approve'), AuthzError);
});

test('canAccessCustomer honors wildcard and explicit scope', () => {
  const wild = principalFromUser(user({ allowedCustomers: '*' }));
  assert.equal(canAccessCustomer(wild, 'anyone'), true);
  const scoped = principalFromUser(user({ allowedCustomers: ['acme', 'globex'] }));
  assert.equal(canAccessCustomer(scoped, 'acme'), true);
  assert.equal(canAccessCustomer(scoped, 'umbrella'), false);
});

test('UserStore provision / get / duplicate / not-found', () => {
  const store = new UserStore();
  store.provision(user());
  assert.equal(store.get('u1').email, 'u1@x.com');
  assert.throws(() => store.provision(user()), AuthzError); // duplicate
  assert.throws(() => store.get('missing'), AuthzError); // not found
});

test('UserStore deactivate / assignRoles / setCustomerScope', () => {
  const store = new UserStore();
  store.provision(user());
  store.assignRoles('u1', ['auditor']);
  assert.deepEqual(store.get('u1').roles, ['auditor']);
  store.setCustomerScope('u1', ['acme']);
  assert.deepEqual(store.get('u1').allowedCustomers, ['acme']);
  store.deactivate('u1');
  assert.equal(store.get('u1').active, false);
});

test('UserStore list returns all users', () => {
  const store = new UserStore();
  store.provision(user());
  store.provision(user({ id: 'u2', email: 'u2@x.com' }));
  assert.equal(store.list().length, 2);
});

test('UserStore authenticate resolves a principal; inactive blocked', () => {
  const store = new UserStore();
  store.provision(user());
  assert.equal(store.authenticate('u1').userId, 'u1');
  store.deactivate('u1');
  assert.throws(() => store.authenticate('u1'), AuthzError);
});
