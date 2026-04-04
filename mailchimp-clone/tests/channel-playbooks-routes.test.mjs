import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelPlaybooksDashboardRoutes, createChannelPlaybooksApiRoutes, createChannelPlaybooksOpsRoutes, createChannelPlaybooksPublicRoutes } from '../packages/channel-playbooks/index.mjs';

test('channel-playbooks routes honor custom base paths and stable ids', () => {
  const dashboard = createChannelPlaybooksDashboardRoutes('/labs/channel-playbooks');
  const api = createChannelPlaybooksApiRoutes('/api/labs/channel-playbooks');
  const ops = createChannelPlaybooksOpsRoutes('/ops/labs/channel-playbooks');
  const pub = createChannelPlaybooksPublicRoutes('/public/labs/channel-playbooks');
  assert.equal(dashboard[0].path, '/labs/channel-playbooks');
  assert.equal(api[0].path, '/api/labs/channel-playbooks/overview');
  assert.equal(ops[0].path, '/ops/labs/channel-playbooks/health');
  assert.equal(pub[0].path, '/public/labs/channel-playbooks');
  assert.match(dashboard[0].id, /channel\-playbooks/);
  assert.match(api[2].id, /channel\-playbooks/);
});

