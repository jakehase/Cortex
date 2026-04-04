import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialPublisherSnapshot, createSocialPublisherDashboardRoutes, createSocialPublisherApiRoutes, createSocialPublisherOpsRoutes, createSocialPublisherPublicRoutes, summarizeSocialPublisherFixtures } from '../packages/social-publisher/index.mjs';

test('social-publisher package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildSocialPublisherSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSocialPublisherDashboardRoutes().length, 3);
  assert.equal(createSocialPublisherApiRoutes().length, 3);
  assert.equal(createSocialPublisherOpsRoutes().length, 3);
  assert.equal(createSocialPublisherPublicRoutes().length, 3);
  assert.equal(summarizeSocialPublisherFixtures().contacts, 2);
});
