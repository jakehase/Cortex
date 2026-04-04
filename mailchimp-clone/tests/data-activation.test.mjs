import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataActivationSnapshot, createDataActivationDashboardRoutes, createDataActivationApiRoutes, createDataActivationOpsRoutes, createDataActivationPublicRoutes, summarizeDataActivationFixtures } from '../packages/data-activation/index.mjs';

test('data-activation package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildDataActivationSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataActivationDashboardRoutes().length, 3);
  assert.equal(createDataActivationApiRoutes().length, 3);
  assert.equal(createDataActivationOpsRoutes().length, 3);
  assert.equal(createDataActivationPublicRoutes().length, 3);
  assert.equal(summarizeDataActivationFixtures().contacts, 2);
});

