import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { buildTeamGovernanceRuntimeSnapshot } from '../packages/app/domain-core.mjs';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('team governance runtime records permission policies, delegation, SCIM, access review, region policy, snapshots, and API evidence', async () => {
  const { server, baseUrl } = await boot();
  const jar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, jar, '/signup', {
      name: 'Team Governance Owner',
      email: 'team-governance@example.com',
      password: 'secret123',
      workspaceName: 'Team Governance Lab'
    });
    await followRedirect(baseUrl, jar, signup);

    await postForm(baseUrl, jar, '/team/invitations', { email: 'admin-team@example.com', role: 'admin' });
    const teamPage = await request(baseUrl, jar, '/team');
    const teamHtml = await teamPage.text();
    assert.match(teamHtml, /Team governance runtime/);
    assert.match(teamHtml, /admin-team@example.com/);

    const governancePage = await request(baseUrl, jar, '/team/governance');
    assert.match(await governancePage.text(), /Permission policy matrix/);

    await postForm(baseUrl, jar, '/team/policies', {
      role: 'admin',
      permissions: 'campaigns:send,audience:export,reports:read',
      scope: 'workspace',
      enforcement: 'enforced'
    });
    assert.equal(server.state.db.teamPermissionPolicyEvents[0].role, 'admin');
    assert.deepEqual(server.state.db.workspaces[0].settings.teamPermissionPolicies.admin.permissions, ['campaigns:send', 'audience:export', 'reports:read']);

    await postForm(baseUrl, jar, '/team/access-review', {
      reviewName: 'Quarterly access review',
      attestation: 'memberships_pending_review'
    });
    assert.equal(server.state.db.teamAccessReviewEvents[0].status, 'open');

    await postForm(baseUrl, jar, '/team/delegated-admin', {
      delegatedRole: 'admin',
      scope: 'audience_management'
    });
    assert.equal(server.state.db.teamDelegatedAdminEvents[0].scope, 'audience_management');

    await postForm(baseUrl, jar, '/team/scim', {
      externalId: 'scim-001',
      email: 'scim-user@example.test',
      action: 'provision_user',
      role: 'member'
    });
    assert.equal(server.state.db.teamScimProvisioningEvents[0].status, 'applied');

    await postForm(baseUrl, jar, '/team/regions', {
      region: 'us',
      dataResidency: 'enabled',
      policy: 'workspace_data_region_enforced'
    });
    assert.equal(server.state.db.teamRegionGovernanceEvents[0].region, 'us');

    const apiKey = server.state.db.workspaces[0].apiKey;
    const runtimeApi = await request(baseUrl, null, '/api/team/runtime', { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal(runtimeApi.status, 200);
    const runtimePayload = await runtimeApi.json();
    assert.equal(runtimePayload.ok, true);
    assert.equal(runtimePayload.teamRuntime.surfaceId, 'team_governance_permissions_runtime_layer');
    assert.equal(runtimePayload.teamRuntime.runtimeHealth.permissionPolicyReady, true);
    assert.equal(runtimePayload.teamRuntime.runtimeHealth.accessReviewReady, true);
    assert.equal(runtimePayload.teamRuntime.runtimeHealth.delegatedAdminReady, true);
    assert.equal(runtimePayload.teamRuntime.runtimeHealth.scimProvisioningReady, true);
    assert.equal(runtimePayload.teamRuntime.runtimeHealth.regionGovernanceReady, true);

    const snapshotPage = await request(baseUrl, jar, '/team/runtime/snapshot');
    assert.equal(snapshotPage.status, 200);
    assert.match(await snapshotPage.text(), /Team governance runtime snapshot/);
    assert.equal(server.state.db.teamGovernanceRuntimeSnapshots.length, 1);

    const snapshot = buildTeamGovernanceRuntimeSnapshot(server.state, server.state.db.workspaces[0].id);
    assert.equal(snapshot.runtimeHealth.snapshotReady, true);
    assert.equal(snapshot.permissionPolicies.eventCount, 1);
    assert.equal(snapshot.accessReviews.count, 1);
    assert.equal(snapshot.scimProvisioning.count, 1);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
