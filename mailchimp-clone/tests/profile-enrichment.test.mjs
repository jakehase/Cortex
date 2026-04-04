import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileEnrichmentSnapshot, createProfileEnrichmentDashboardRoutes, createProfileEnrichmentApiRoutes, createProfileEnrichmentOpsRoutes, createProfileEnrichmentPublicRoutes, summarizeProfileEnrichmentFixtures } from '../packages/profile-enrichment/index.mjs';

test('profile-enrichment package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildProfileEnrichmentSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createProfileEnrichmentDashboardRoutes().length, 3);
  assert.equal(createProfileEnrichmentApiRoutes().length, 3);
  assert.equal(createProfileEnrichmentOpsRoutes().length, 3);
  assert.equal(createProfileEnrichmentPublicRoutes().length, 3);
  assert.equal(summarizeProfileEnrichmentFixtures().contacts, 2);
});

