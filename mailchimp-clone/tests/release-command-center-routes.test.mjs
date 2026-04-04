import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseCommandCenterDashboardRoutes, createReleaseCommandCenterApiRoutes, createReleaseCommandCenterOpsRoutes, createReleaseCommandCenterPublicRoutes } from '../packages/release-command-center/index.mjs';

test('release-command-center routes honor custom base paths and stable ids', () => {
  const dashboard = createReleaseCommandCenterDashboardRoutes('/labs/release-command-center');
  const api = createReleaseCommandCenterApiRoutes('/api/labs/release-command-center');
  const ops = createReleaseCommandCenterOpsRoutes('/ops/labs/release-command-center');
  const pub = createReleaseCommandCenterPublicRoutes('/public/labs/release-command-center');
  assert.equal(dashboard[0].path, '/labs/release-command-center');
  assert.equal(api[0].path, '/api/labs/release-command-center/overview');
  assert.equal(ops[0].path, '/ops/labs/release-command-center/health');
  assert.equal(pub[0].path, '/public/labs/release-command-center');
  assert.match(dashboard[0].id, /release\-command\-center/);
  assert.match(api[2].id, /release\-command\-center/);
});

