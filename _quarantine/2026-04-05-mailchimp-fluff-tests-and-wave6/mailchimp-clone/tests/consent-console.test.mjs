import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentConsoleSnapshot, createConsentConsoleDashboardRoutes, createConsentConsoleApiRoutes, createConsentConsoleOpsRoutes, createConsentConsolePublicRoutes, createConsentConsoleRegistryRoutes, summarizeConsentConsoleFixtures } from '../packages/consent-console/index.mjs';

test('consent-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentConsoleDashboardRoutes().length, 3);
  assert.equal(createConsentConsoleApiRoutes().length, 4);
  assert.equal(createConsentConsoleOpsRoutes().length, 3);
  assert.equal(createConsentConsolePublicRoutes().length, 3);
  assert.equal(createConsentConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentConsoleFixtures().contacts, 2);
});

