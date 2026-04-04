import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelPlaybooksSnapshot, createChannelPlaybooksDashboardRoutes, createChannelPlaybooksApiRoutes, createChannelPlaybooksOpsRoutes, createChannelPlaybooksPublicRoutes, summarizeChannelPlaybooksFixtures } from '../packages/channel-playbooks/index.mjs';

test('channel-playbooks package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildChannelPlaybooksSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createChannelPlaybooksDashboardRoutes().length, 3);
  assert.equal(createChannelPlaybooksApiRoutes().length, 3);
  assert.equal(createChannelPlaybooksOpsRoutes().length, 3);
  assert.equal(createChannelPlaybooksPublicRoutes().length, 3);
  assert.equal(summarizeChannelPlaybooksFixtures().contacts, 2);
});

