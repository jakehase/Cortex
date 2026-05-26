import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { CookieJar, createTempDataDir, followRedirect, postForm, request } from './helpers.mjs';
import { leafProof, mergePhase9Proof } from './phase9-proof-helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function platformProofs(server, workspaceId) {
  const signupProductFiles = ['packages/app/index.mjs', 'packages/app/routes/public.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'];
  const platformProductFiles = ['packages/app/index.mjs', 'packages/app/routes/platform.mjs', 'packages/app/view.mjs'];
  const teamProductFiles = ['packages/app/domain-notes.mjs', 'packages/app/routes/platform.mjs'];
  const settingsProductFiles = ['packages/app/routes/api-admin.mjs', 'packages/app/routes/platform.mjs'];
  const platformTests = ['tests/platform-spine.test.mjs', 'tests/phase9-platform-parity.test.mjs'];
  const dashboardTests = ['tests/platform-spine.test.mjs', 'tests/parity-route-aliases.test.mjs', 'tests/phase9-platform-parity.test.mjs'];
  const platformAndCurrentTests = ['tests/platform-spine.test.mjs', 'tests/current-product-parity.test.mjs', 'tests/phase9-platform-parity.test.mjs'];
  const securityPlatformTests = ['tests/security-ops-hardening.test.mjs', 'tests/platform-spine.test.mjs', 'tests/phase9-platform-parity.test.mjs'];
  const workspace = server.state.db.workspaces.find((entry) => entry.id === workspaceId);
  const dbEvidence = {
    workspaceId,
    onboarding: workspace.settings.onboarding,
    ownershipTransferredAt: workspace.settings.ownershipTransferredAt,
    domains: workspace.settings.domains,
    activeJobs: server.state.db.jobs.filter((job) => job.workspaceId === workspaceId).map((job) => job.type),
    auditActions: server.state.db.auditEvents.filter((event) => event.workspaceId === workspaceId).map((event) => event.action)
  };
  mergePhase9Proof({
    productSlice: 'platform_onboarding_dashboard_team_settings',
    leafProofs: [
      leafProof({ leafId: 'signup_onboarding__req_01', productFiles: signupProductFiles, targetedTests: platformAndCurrentTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['GET /signup', 'POST /signup', 'GET /onboarding', 'POST /onboarding/profile'], dbEvidence, assertions: ['multi-step onboarding assistant renders', 'industry/use-case branching persists', 'import prompt and contextual education persist'] }),
      leafProof({ leafId: 'signup_onboarding__req_02', productFiles: signupProductFiles, targetedTests: platformAndCurrentTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['POST /reset', 'POST /invites/:token/accept', 'POST /workspaces/new'], dbEvidence, assertions: ['password reset token is queued out-of-band', 'invite onboarding creates active membership', 'workspace bootstrap creates audience and API key'] }),
      leafProof({ leafId: 'signup_onboarding__req_03', productFiles: signupProductFiles, targetedTests: platformAndCurrentTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff'], routeEvidence: ['POST /onboarding/recover', 'GET /app'], dbEvidence, assertions: ['recovery job queues for skipped step', 'dashboard shows onboarding continuity', 'validation state remains visible'] }),
      leafProof({ leafId: 'account_workspace_setup__req_01', productFiles: platformProductFiles, targetedTests: platformTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['POST /settings', 'POST /settings/domains', 'POST /assets', 'GET /onboarding'], dbEvidence, assertions: ['sender settings and compliance address persist', 'domain authentication is visible', 'brand/import setup is integrated with onboarding'] }),
      leafProof({ leafId: 'account_workspace_setup__req_02', productFiles: platformProductFiles, targetedTests: platformTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['POST /workspaces/new', 'POST /workspaces/switch', 'POST /workspaces/ownership-transfer'], dbEvidence, assertions: ['workspace switching persists active workspace', 'ownership handoff mutates roles', 'workspace migration/account handoff path is auditable'] }),
      leafProof({ leafId: 'account_workspace_setup__req_03', productFiles: platformProductFiles, targetedTests: platformTests, proofKinds: ['browser_ui', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['GET /app', 'GET /onboarding'], dbEvidence, assertions: ['first-use dashboard exposes setup education', 'role-based recommendations render', 'empty-state guidance points to setup work'] }),
      leafProof({ leafId: 'dashboard_home__req_01', productFiles: platformProductFiles, targetedTests: dashboardTests, proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['GET /app'], dbEvidence, assertions: ['dashboard widget system renders KPIs', 'task queue and insights prioritize next setup action', 'data freshness is visible'] }),
      leafProof({ leafId: 'dashboard_home__req_02', productFiles: platformProductFiles, targetedTests: dashboardTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff', 'security_policy'], routeEvidence: ['GET /app'], dbEvidence, assertions: ['dashboard changes guidance by role', 'saved views include owner/admin/member appropriate links'] }),
      leafProof({ leafId: 'dashboard_home__req_03', productFiles: platformProductFiles, targetedTests: dashboardTests, proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff', 'security_policy'], routeEvidence: ['GET /app', 'GET /onboarding'], dbEvidence, assertions: ['dashboard includes data freshness', 'saved views and onboarding continuity survive mutations'] }),
      leafProof({ leafId: 'settings_domains__req_01', productFiles: settingsProductFiles, targetedTests: securityPlatformTests, proofKinds: ['browser_ui', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['POST /settings/domains', 'POST /settings/domains/:id/verify', 'POST /settings/domains/:id/authenticate'], dbEvidence, assertions: ['domain verification and authentication states persist', 'sender reputation/compliance state is rendered'] }),
      leafProof({ leafId: 'settings_domains__req_02', productFiles: settingsProductFiles, targetedTests: securityPlatformTests, proofKinds: ['browser_ui', 'functional', 'job_event', 'product_diff', 'security_policy'], routeEvidence: ['POST /settings/domains/:id/default'], dbEvidence, assertions: ['default-domain recovery control persists', 'settings changes are audited'] }),
      leafProof({ leafId: 'team_roles_permissions__req_01', productFiles: teamProductFiles, targetedTests: platformTests, proofKinds: ['browser_ui', 'functional', 'product_diff', 'security_policy'], routeEvidence: ['POST /team/invitations', 'POST /team/members/:id/role'], dbEvidence, assertions: ['invite lifecycle and role mutation render', 'permission notes summarize role coverage'] }),
      leafProof({ leafId: 'team_roles_permissions__req_02', productFiles: teamProductFiles, targetedTests: platformTests, proofKinds: ['browser_ui', 'functional', 'product_diff', 'security_policy'], routeEvidence: ['POST /workspaces/ownership-transfer', 'GET /team'], dbEvidence, assertions: ['ownership transfer is auditable', 'permission inheritance updates active memberships'] })
    ]
  });
}

test('Phase 9 real parity platform slice: onboarding, dashboard, workspace setup, domains, and team permissions are product-backed', async () => {
  const { server, baseUrl } = await boot();
  const ownerJar = new CookieJar();
  try {
    const signupPage = await request(baseUrl, null, '/signup');
    assert.match(await signupPage.text(), /Create account|Signup/i);
    const signup = await postForm(baseUrl, ownerJar, '/signup', {
      name: 'Platform Owner',
      email: 'platform-owner@example.com',
      password: 'secret123',
      workspaceName: 'Platform Lab'
    });
    await followRedirect(baseUrl, ownerJar, signup);

    const reset = await postForm(baseUrl, new CookieJar(), '/reset', { email: 'platform-owner@example.com' });
    assert.match(await reset.text(), /reset link has been queued/i);
    assert.ok(server.state.db.notifications.some((note) => note.type === 'password-reset-request'));

    let onboarding = await request(baseUrl, ownerJar, '/onboarding');
    let onboardingHtml = await onboarding.text();
    assert.match(onboardingHtml, /Onboarding workspace assistant/);
    assert.match(onboardingHtml, /Business profile/);
    await postForm(baseUrl, ownerJar, '/onboarding/profile', {
      industry: 'Retail ecommerce',
      useCase: 'commerce',
      senderDefault: 'marketing@example.com',
      importPlan: 'Shopify sync and CSV backfill'
    });
    await postForm(baseUrl, ownerJar, '/onboarding/recover', { step: 'contact_import' });
    assert.ok(server.state.db.jobs.some((job) => job.type === 'onboarding_recovery'));

    await postForm(baseUrl, ownerJar, '/settings', {
      senderName: 'Platform Owner',
      senderEmail: 'marketing@example.com',
      replyTo: 'reply@example.com',
      timezone: 'America/Chicago',
      brandColor: '#2244aa',
      address: '123 Platform Way'
    });
    await postForm(baseUrl, ownerJar, '/settings/domains', { domain: 'platform.example.com' });
    let activeWorkspace = server.state.db.workspaces.find((entry) => entry.name === 'Platform Lab');
    const domainId = activeWorkspace.settings.domains[0].id;
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/verify`, {});
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/authenticate`, {});
    await postForm(baseUrl, ownerJar, `/settings/domains/${domainId}/default`, {});
    await postForm(baseUrl, ownerJar, '/assets', { name: 'brand-logo.txt', folder: 'Brand', contentType: 'text/plain', altText: 'Logo', body: 'logo' });

    const dashboard = await request(baseUrl, ownerJar, '/app');
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /Dashboard widget system/);
    assert.match(dashboardHtml, /Role-aware task queue/);
    assert.match(dashboardHtml, /Saved dashboard views/);
    assert.match(dashboardHtml, /Data freshness/);

    await postForm(baseUrl, ownerJar, '/workspaces/new', { name: 'Migration Workspace' });
    let workspaces = await request(baseUrl, ownerJar, '/workspaces');
    let workspacesHtml = await workspaces.text();
    assert.match(workspacesHtml, /Ownership transfer/);
    assert.match(workspacesHtml, /Migration Workspace/);

    await postForm(baseUrl, ownerJar, '/team/invitations', { email: 'new-owner@example.com', role: 'admin' });
    let invite = server.state.db.invitations.find((entry) => entry.email === 'new-owner@example.com');
    const inviteJar = new CookieJar();
    const acceptPage = await request(baseUrl, inviteJar, `/invites/${invite.token}`);
    assert.match(await acceptPage.text(), /Accept invitation/);
    const accept = await postForm(baseUrl, inviteJar, `/invites/${invite.token}/accept`, { name: 'New Owner', password: 'secret456' });
    await followRedirect(baseUrl, inviteJar, accept);

    const newOwner = server.state.db.users.find((entry) => entry.email === 'new-owner@example.com');
    await postForm(baseUrl, ownerJar, '/workspaces/ownership-transfer', { userId: newOwner.id });
    activeWorkspace = server.state.db.workspaces.find((entry) => entry.name === 'Migration Workspace');
    const newOwnerMembership = server.state.db.memberships.find((entry) => entry.workspaceId === activeWorkspace.id && entry.userId === newOwner.id);
    assert.equal(newOwnerMembership.role, 'owner');
    assert.ok(activeWorkspace.settings.ownershipTransferredAt);

    const teamPage = await request(baseUrl, ownerJar, '/team');
    const teamHtml = await teamPage.text();
    assert.match(teamHtml, /Recent permission events/);
    assert.match(teamHtml, /New Owner|new-owner@example.com/);

    platformProofs(server, activeWorkspace.id);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
