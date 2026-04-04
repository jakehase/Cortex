import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInboxMacrosSnapshot, createInboxMacrosDashboardRoutes, createInboxMacrosApiRoutes, createInboxMacrosOpsRoutes, createInboxMacrosPublicRoutes, summarizeInboxMacrosFixtures } from '../packages/inbox-macros/index.mjs';

test('inbox-macros package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildInboxMacrosSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInboxMacrosDashboardRoutes().length, 3);
  assert.equal(createInboxMacrosApiRoutes().length, 3);
  assert.equal(createInboxMacrosOpsRoutes().length, 3);
  assert.equal(createInboxMacrosPublicRoutes().length, 3);
  assert.equal(summarizeInboxMacrosFixtures().contacts, 2);
});
