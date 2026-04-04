import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceExchangeSnapshot, createAudienceExchangeDashboardRoutes, createAudienceExchangeApiRoutes, createAudienceExchangeOpsRoutes, createAudienceExchangePublicRoutes, createAudienceExchangeRegistryRoutes, summarizeAudienceExchangeFixtures } from '../packages/audience-exchange/index.mjs';

test('audience-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceExchangeDashboardRoutes().length, 3);
  assert.equal(createAudienceExchangeApiRoutes().length, 4);
  assert.equal(createAudienceExchangeOpsRoutes().length, 3);
  assert.equal(createAudienceExchangePublicRoutes().length, 3);
  assert.equal(createAudienceExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceExchangeFixtures().contacts, 2);
});

