import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceConsoleSnapshot, createAudienceConsoleDashboardRoutes, createAudienceConsoleApiRoutes, createAudienceConsoleOpsRoutes, createAudienceConsolePublicRoutes, createAudienceConsoleRegistryRoutes, summarizeAudienceConsoleFixtures } from '../packages/audience-console/index.mjs';

test('audience-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceConsoleDashboardRoutes().length, 3);
  assert.equal(createAudienceConsoleApiRoutes().length, 4);
  assert.equal(createAudienceConsoleOpsRoutes().length, 3);
  assert.equal(createAudienceConsolePublicRoutes().length, 3);
  assert.equal(createAudienceConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceConsoleFixtures().contacts, 2);
});

