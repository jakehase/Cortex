import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileEnrichmentDashboardRoutes, createProfileEnrichmentApiRoutes, createProfileEnrichmentOpsRoutes, createProfileEnrichmentPublicRoutes } from '../packages/profile-enrichment/index.mjs';

test('profile-enrichment routes honor custom base paths and stable ids', () => {
  const dashboard = createProfileEnrichmentDashboardRoutes('/labs/profile-enrichment');
  const api = createProfileEnrichmentApiRoutes('/api/labs/profile-enrichment');
  const ops = createProfileEnrichmentOpsRoutes('/ops/labs/profile-enrichment');
  const pub = createProfileEnrichmentPublicRoutes('/public/labs/profile-enrichment');
  assert.equal(dashboard[0].path, '/labs/profile-enrichment');
  assert.equal(api[0].path, '/api/labs/profile-enrichment/overview');
  assert.equal(ops[0].path, '/ops/labs/profile-enrichment/health');
  assert.equal(pub[0].path, '/public/labs/profile-enrichment');
  assert.match(dashboard[0].id, /profile\-enrichment/);
  assert.match(api[2].id, /profile\-enrichment/);
});

