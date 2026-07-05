import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('Program 1 platform spine: auth lifecycle, workspace switching, team invite acceptance, gating, audit export, assets, admin shell, API auth', async () => {
  const { server, baseUrl } = await boot();
  const ownerJar = new CookieJar();
  try {
    const signup = await postForm(baseUrl, ownerJar, '/signup', {
      name: 'Owner One',
      email: 'owner@example.com',
      password: 'secret123',
      workspaceName: 'Anchor Workspace'
    });
    assert.equal(signup.status, 302);
    const dashboard = await followRedirect(baseUrl, ownerJar, signup);
    assert.match(await dashboard.text(), /Dashboard/);

    const logout = await postForm(baseUrl, ownerJar, '/logout', {});
    assert.equal(logout.status, 302);
    const login = await postForm(baseUrl, ownerJar, '/login', { email: 'owner@example.com', password: 'secret123' });
    assert.equal(login.status, 302);
    await followRedirect(baseUrl, ownerJar, login);

    const reset = await postForm(baseUrl, new CookieJar(), '/reset', { email: 'owner@example.com' });
    const resetHtml = await reset.text();
    assert.doesNotMatch(resetHtml, /Generated token:/);
    const resetPath = server.state.db.notifications[0].payload.resetPath;
    const resetToken = resetPath.match(/reset_[a-f0-9]+/)[0];
    const resetPage = await request(baseUrl, null, resetPath);
    assert.match(await resetPage.text(), /Update password/);
    const resetComplete = await postForm(baseUrl, new CookieJar(), `/reset/${resetToken}`, { password: 'secret789', confirmPassword: 'secret789' });
    assert.equal(resetComplete.status, 302);

    await postForm(baseUrl, ownerJar, '/logout', {});
    const loginAfterReset = await postForm(baseUrl, ownerJar, '/login', { email: 'owner@example.com', password: 'secret789' });
    assert.equal(loginAfterReset.status, 302);
    await followRedirect(baseUrl, ownerJar, loginAfterReset);

    await postForm(baseUrl, ownerJar, '/workspaces/new', { name: 'Ops Workspace' });
    let workspacesPage = await request(baseUrl, ownerJar, '/workspaces');
    let workspacesHtml = await workspacesPage.text();
    assert.match(workspacesHtml, /Anchor Workspace/);
    assert.match(workspacesHtml, /Ops Workspace/);

    await postForm(baseUrl, ownerJar, '/workspaces/switch', { workspaceId: server.state.db.workspaces[0].id });
    const appAfterSwitch = await request(baseUrl, ownerJar, '/app');
    assert.match(await appAfterSwitch.text(), /Ops Workspace|Anchor Workspace/);

    await postForm(baseUrl, ownerJar, '/billing/plan', { planId: 'growth' });
    const billingPage = await request(baseUrl, ownerJar, '/billing');
    const billingHtml = await billingPage.text();
    assert.match(billingHtml, /Visible gates/);
    assert.match(billingHtml, /Growth/);

    await postForm(baseUrl, ownerJar, '/feature-flags/toggle', { key: 'auditExport' });
    await postForm(baseUrl, ownerJar, '/feature-flags/toggle', { key: 'auditExport' });

    await postForm(baseUrl, ownerJar, '/settings', {
      senderName: 'Owner One',
      senderEmail: 'sender@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#123456',
      address: '123 Main'
    });
    await postForm(baseUrl, ownerJar, '/settings/domains', { domain: 'example.com' });
    const activeWorkspace = server.state.db.workspaces.find((entry) => entry.id === server.state.db.users[0].activeWorkspaceId);
    const domainId = activeWorkspace.settings.domains[0].id;
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/verify`, {});
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/authenticate`, {});
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/default`, {});
    const settingsPage = await request(baseUrl, ownerJar, '/settings');
    const settingsHtml = await settingsPage.text();
    assert.match(settingsHtml, /reply@example.com/);
    assert.match(settingsHtml, /Authenticated default domain: example.com/);
    assert.match(settingsHtml, /authenticated/);

    await postForm(baseUrl, ownerJar, '/onboarding/profile', {
      industry: 'Retail ecommerce',
      useCase: 'commerce',
      senderDefault: 'sender@example.com',
      importPlan: 'CSV import plus Shopify backfill'
    });
    const onboardingPage = await request(baseUrl, ownerJar, '/onboarding');
    const onboardingHtml = await onboardingPage.text();
    assert.match(onboardingHtml, /Operational readiness runtime/);
    assert.match(onboardingHtml, /Workspace setup command/);
    assert.match(onboardingHtml, /First campaign handoff/);
    await postForm(baseUrl, ownerJar, '/onboarding/workspace-command', { command: 'brand_assets', note: 'Need launch logo and footer defaults' });
    await postForm(baseUrl, ownerJar, '/onboarding/recover', { step: 'audience_import', retryTarget: '/contacts/import' });
    const handoff = await postForm(baseUrl, ownerJar, '/onboarding/first-campaign-handoff', { name: 'Owner launch campaign', subject: 'A note from Owner One' });
    assert.equal(handoff.status, 302);
    assert.ok(server.state.db.campaigns.some((campaign) => campaign.onboardingHandoff?.source === 'platform_onboarding_workspace_runtime'));
    const onboardingRuntimeRes = await request(baseUrl, ownerJar, '/api/onboarding/runtime');
    const onboardingRuntime = await onboardingRuntimeRes.json();
    assert.equal(onboardingRuntime.ok, true);
    assert.ok(onboardingRuntime.onboarding.workspaceSetup.commandEventCount >= 1);
    assert.ok(onboardingRuntime.onboarding.onboarding.recoveryEventCount >= 1);
    assert.ok(onboardingRuntime.onboarding.firstCampaignHandoff.count >= 1);

    await postForm(baseUrl, ownerJar, '/assets', {
      name: 'hero.txt',
      folder: 'Launch',
      contentType: 'text/plain',
      altText: 'Hero asset',
      body: 'asset-body'
    });
    const assetsPage = await request(baseUrl, ownerJar, '/assets');
    const assetsHtml = await assetsPage.text();
    assert.match(assetsHtml, /Content studio/);
    assert.match(assetsHtml, /hero.txt/);

    await postForm(baseUrl, ownerJar, '/team/invitations', { email: 'admin@example.com', role: 'admin' });
    const teamPage = await request(baseUrl, ownerJar, '/team');
    const teamHtml = await teamPage.text();
    assert.match(teamHtml, /admin@example.com/);
    const inviteId = server.state.db.invitations[0].id;
    await postForm(baseUrl, ownerJar, `/team/invitations/${inviteId}/resend`, {});
    const refreshedTeamPage = await request(baseUrl, ownerJar, '/team');
    const invitePath = (await refreshedTeamPage.text()).match(/\/invites\/(invite_token_[a-f0-9]+)/)[0];

    const inviteJar = new CookieJar();
    const acceptPage = await request(baseUrl, inviteJar, invitePath);
    assert.match(await acceptPage.text(), /Accept invitation/);
    const accept = await postForm(baseUrl, inviteJar, `${invitePath}/accept`, { name: 'Admin User', password: 'secret456' });
    assert.equal(accept.status, 302);
    const inviteApp = await followRedirect(baseUrl, inviteJar, accept);
    assert.match(await inviteApp.text(), /Admin User/);

    const adminMembershipId = server.state.db.memberships.find((entry) => entry.workspaceId === activeWorkspace.id && entry.userId !== server.state.db.users[0].id && entry.status === 'active').id;
    await postForm(baseUrl, ownerJar, `/team/members/${adminMembershipId}/role`, { role: 'member' });
    const updatedTeamPage = await request(baseUrl, ownerJar, '/team');
    assert.match(await updatedTeamPage.text(), /member/);

    const adminShell = await request(baseUrl, ownerJar, '/admin');
    assert.match(await adminShell.text(), /Protected surfaces/);

    const auditPage = await request(baseUrl, ownerJar, '/audit');
    assert.match(await auditPage.text(), /audit/i);
    const auditCsv = await request(baseUrl, ownerJar, '/audit/export.csv');
    assert.equal(auditCsv.status, 200);
    assert.match(await auditCsv.text(), /billing-plan-change/);

    workspacesPage = await request(baseUrl, ownerJar, '/workspaces');
    workspacesHtml = await workspacesPage.text();
    const apiKey = workspacesHtml.match(/key_[a-f0-9]+/)[0];
    const apiMe = await request(baseUrl, null, '/api/me', { headers: { authorization: `Bearer ${apiKey}` } });
    const me = await apiMe.json();
    assert.equal(me.ok, true);
    assert.equal(me.workspace.planId, 'growth');

    const statusRes = await request(baseUrl, null, '/status');
    const status = await statusRes.json();
    assert.equal(status.ok, true);
    assert.ok(status.counts.workspaces >= 2);

    const notificationsPage = await request(baseUrl, ownerJar, '/notifications');
    assert.match(await notificationsPage.text(), /invite|password-reset-complete|invite-resend/);
    const eventsPage = await request(baseUrl, ownerJar, '/events');
    assert.match(await eventsPage.text(), /job|audit|invite/i);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
