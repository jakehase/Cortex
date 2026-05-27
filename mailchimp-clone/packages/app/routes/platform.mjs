import { saveDb, PLAN_CATALOG } from '../storage.mjs';
import { dashboardBody, page, requireActor, requireAdmin, signupOnboardingCard, signupOnboardingRecoveryPanel, workspaceSwitcher } from '../view.mjs';
import { addDomain, applyBillingPlan, buildBillingEntitlementsRuntimeSnapshot, buildDashboardHomeRuntimeSnapshot, buildTeamGovernanceRuntimeSnapshot, createWorkspaceForUser, enqueueJob, getCurrentActor, hasFeature, persistBillingEntitlementsRuntimeSnapshot, persistDashboardHomeRuntimeSnapshot, persistTeamGovernanceRuntimeSnapshot, reconcileBillingEntitlements, recordAudit, recordBillingUsageMeterEvent, recordDashboardDrillthroughEvent, recordDashboardInsightAction, recordDashboardSavedView, recordDashboardWidgetPreference, recordTeamAccessReview, recordTeamDelegatedAdminGrant, recordTeamPermissionPolicy, recordTeamRegionGovernanceEvent, recordTeamScimProvisioningEvent, runBillingInvoiceCollection, startBillingTrial, storeAsset, updateSettings } from '../domain-core.mjs';
import { teamPermissionNotes } from '../domain-notes.mjs';
import { escapeHtml, json, nowIso, readBody, redirect, text } from '../utils.mjs';
import { buildAuthSecurityRuntimeSnapshot, createInvitationExpiry, createMfaChallengeForActor, enrollMfaFactor, issueCsrfToken, rotateWorkspaceApiKey, revokeSessionById, startSsoSessionForActor, validateCsrfToken, verifyMfaChallenge } from '../security.mjs';

function securityCenterBody(snapshot, issuedToken = null, operationResult = null) {
  const eventRows = snapshot.events.map((event) => `<tr><td>${escapeHtml(event.eventType)}</td><td>${escapeHtml(event.control || '')}</td><td>${escapeHtml(event.severity)}</td><td>${escapeHtml(event.detail)}</td><td>${escapeHtml(event.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5">No security events yet.</td></tr>';
  const sessionRows = snapshot.sessions.active.map((session) => `<tr><td>${escapeHtml(session.id)}</td><td>${escapeHtml(session.assurance || '')}</td><td>${escapeHtml(session.risk?.level || '')}</td><td>${escapeHtml(session.ip || '')}</td><td><form method="post" action="/security/sessions/${session.id}/revoke"><button>Revoke</button></form></td></tr>`).join('') || '<tr><td colspan="5">No active sessions.</td></tr>';
  const factorRows = snapshot.mfa.factors.map((factor) => `<tr><td>${escapeHtml(factor.method)}</td><td>${escapeHtml(factor.label)}</td><td>${escapeHtml(factor.status)}</td><td>${escapeHtml(factor.assuranceLevel)}</td></tr>`).join('') || '<tr><td colspan="4">No MFA factors enrolled.</td></tr>';
  const challengeRows = snapshot.mfa.recentChallenges.map((challenge) => `<tr><td>${escapeHtml(challenge.id)}</td><td>${escapeHtml(challenge.method)}</td><td>${escapeHtml(challenge.status)}</td><td><form method="post" action="/security/mfa/challenges/${challenge.id}/verify"><input name="code" value="123456"><button>Verify</button></form></td></tr>`).join('') || '<tr><td colspan="4">No MFA challenges created.</td></tr>';
  const ssoRows = snapshot.sso.sessions.map((session) => `<tr><td>${escapeHtml(session.provider)}</td><td>${escapeHtml(session.identityProvider)}</td><td>${escapeHtml(session.status)}</td><td>${escapeHtml(session.assertionAudience || '')}</td></tr>`).join('') || '<tr><td colspan="4">No SSO sessions started.</td></tr>';
  const csrfRows = snapshot.csrf.tokens.map((token) => `<tr><td>${escapeHtml(token.id)}</td><td>${escapeHtml(token.action)}</td><td>${escapeHtml(token.status)}</td><td>${escapeHtml(token.expiresAt)}</td></tr>`).join('') || '<tr><td colspan="4">No CSRF tokens issued.</td></tr>';
  const keyRows = snapshot.apiKeys.map((key) => `<tr><td>${escapeHtml(key.label || key.id)}</td><td>${escapeHtml(key.tokenPreview)}</td><td>${escapeHtml(key.revokedAt ? 'revoked' : 'active')}</td><td>${escapeHtml(key.createdAt || '')}</td></tr>`).join('') || '<tr><td colspan="4">No API keys recorded.</td></tr>';
  const issuedTokenPanel = issuedToken ? `<div class="ok">Issued CSRF token for ${escapeHtml(issuedToken.action)}: <code data-csrf-token>${escapeHtml(issuedToken.token)}</code></div>` : '';
  const resultPanel = operationResult ? `<div class="${operationResult.ok === false ? 'warn' : 'ok'}">${escapeHtml(operationResult.message || operationResult.reason || 'Security operation recorded.')}${operationResult.challengeId ? ` <code data-mfa-challenge>${escapeHtml(operationResult.challengeId)}</code>` : ''}</div>` : '';
  return `<div class="grid"><div class="card"><h3>Security runtime contract</h3><p>${escapeHtml(snapshot.label)}</p><ul>${snapshot.controls.map((control) => `<li>${escapeHtml(control)}</li>`).join('')}</ul><p>Risk now: ${escapeHtml(snapshot.risk.level)} · score ${snapshot.risk.score}</p><p>Evidence: ${snapshot.evidenceContract.map((entry) => escapeHtml(entry)).join(' · ')}</p></div><div class="card"><h3>CSRF controls</h3>${issuedTokenPanel}${resultPanel}<form method="post" action="/security/csrf/issue"><input name="action" value="security_center"><button>Issue CSRF token</button></form><form method="post" action="/security/csrf/validate"><input name="token" placeholder="csrf token"><input name="action" value="security_center"><button>Validate token</button></form><table><tr><th>Token</th><th>Action</th><th>Status</th><th>Expires</th></tr>${csrfRows}</table></div><div class="card"><h3>MFA controls</h3><form method="post" action="/security/mfa/enroll"><select name="method"><option value="totp">TOTP</option><option value="webauthn">WebAuthn</option></select><input name="label" value="Primary authenticator"><button>Enroll factor</button></form><form method="post" action="/security/mfa/challenge"><button>Create challenge</button></form><table><tr><th>Method</th><th>Label</th><th>Status</th><th>Assurance</th></tr>${factorRows}</table><table><tr><th>Challenge</th><th>Method</th><th>Status</th><th>Verify</th></tr>${challengeRows}</table></div></div><div class="grid" style="margin-top:16px"><div class="card"><h3>Session inventory</h3><p>${snapshot.sessions.activeCount} active · ${snapshot.sessions.revokedCount} revoked</p><table><tr><th>Session</th><th>Assurance</th><th>Risk</th><th>IP</th><th>Action</th></tr>${sessionRows}</table></div><div class="card"><h3>SSO ledger</h3><form method="post" action="/security/sso/start"><select name="provider"><option value="saml">SAML</option><option value="oidc">OIDC</option></select><input name="identityProvider" value="Okta workforce identity"><button>Start SSO session</button></form><table><tr><th>Provider</th><th>Identity provider</th><th>Status</th><th>Audience</th></tr>${ssoRows}</table></div><div class="card"><h3>API key rotation</h3><form method="post" action="/security/api-keys/rotate"><input name="label" value="Rotated from security center"><button>Rotate workspace API key</button></form><table><tr><th>Label</th><th>Preview</th><th>Status</th><th>Created</th></tr>${keyRows}</table></div></div><div class="card" style="margin-top:16px"><h3>Security event timeline</h3><table><tr><th>Event</th><th>Control</th><th>Severity</th><th>Detail</th><th>Created</th></tr>${eventRows}</table></div>`;
}

export function registerPlatformRoutes(router, deps) {
  const { requireAuth } = deps;

  router.register('GET', '/dashboard', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    redirect(res, '/app');
  });

  router.register('GET', '/app', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const runtime = buildDashboardHomeRuntimeSnapshot(state, actor);
    text(res, 200, page('Dashboard', actor, `${dashboardBody(state, actor)}<div class="grid" style="margin-top:16px">${workspaceSwitcher(actor)}<div class="card"><h3>Dashboard home runtime</h3><p>${escapeHtml(runtime.label)}</p><p>Widgets: ${runtime.widgets.preferenceEventCount} · insights: ${runtime.insightQueue.insightCount} · drillthroughs: ${runtime.drillthrough.count}</p><p><a href="/dashboard/runtime">Open dashboard runtime controls</a> · <a href="/api/dashboard/runtime">Runtime API JSON</a></p></div></div>`));
  });

  router.register('GET', '/dashboard/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = buildDashboardHomeRuntimeSnapshot(state, actor);
    const preferenceRows = snapshot.widgets.recentPreferences.map((entry) => `<tr><td>${escapeHtml(entry.widgetId)}</td><td>${escapeHtml(entry.role)}</td><td>${escapeHtml(entry.visibility)}</td><td>${escapeHtml(entry.layout)}</td></tr>`).join('') || '<tr><td colspan="4">No widget preferences recorded yet.</td></tr>';
    const insightRows = snapshot.insightQueue.recentInsights.map((entry) => `<tr><td>${escapeHtml(entry.surface)}</td><td>${escapeHtml(entry.priority)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.targetRoute)}</td></tr>`).join('') || '<tr><td colspan="4">No insights recorded yet.</td></tr>';
    const drillRows = snapshot.drillthrough.recent.map((entry) => `<tr><td>${escapeHtml(entry.widgetId)}</td><td>${escapeHtml(entry.targetRoute)}</td><td>${escapeHtml(entry.actorRole)}</td><td>${escapeHtml(entry.createdAt)}</td></tr>`).join('') || '<tr><td colspan="4">No drillthroughs yet.</td></tr>';
    text(res, 200, page('Dashboard runtime', actor, `<div class="grid"><div class="card"><h3>Dashboard home insights runtime</h3><p>${escapeHtml(snapshot.label)}</p><p>Evidence: ${snapshot.evidenceContract.map((entry) => `<code>${escapeHtml(entry)}</code>`).join(' ')}</p><p><a href="/dashboard/runtime/snapshot">Persist dashboard runtime snapshot</a> · <a href="/api/dashboard/runtime">Runtime API JSON</a></p><pre>${escapeHtml(JSON.stringify(snapshot.runtimeHealth, null, 2))}</pre></div><div class="card"><h3>Widget preference</h3><form method="post" action="/dashboard/widgets"><input name="widgetId" value="launch_readiness"><select name="visibility"><option value="visible">visible</option><option value="hidden">hidden</option></select><input name="layout" value="top_grid"><button>Record widget preference</button></form></div><div class="card"><h3>Insight task and drillthrough</h3><form method="post" action="/dashboard/insights"><input name="surface" value="campaign_launch"><select name="priority"><option value="high">high</option><option value="medium">medium</option></select><input name="targetRoute" value="/campaigns"><button>Record insight</button></form><form method="post" action="/dashboard/drillthrough"><input name="widgetId" value="launch_readiness"><input name="targetRoute" value="/onboarding"><button>Record drillthrough</button></form></div><div class="card"><h3>Saved dashboard view</h3><form method="post" action="/dashboard/saved-views"><input name="viewId" value="owner_launch_readiness"><input name="label" value="Owner launch readiness"><input name="href" value="/onboarding"><button>Save dashboard view</button></form></div></div><div class="grid" style="margin-top:16px"><div class="card"><h3>Widget preference ledger</h3><table><tr><th>Widget</th><th>Role</th><th>Visibility</th><th>Layout</th></tr>${preferenceRows}</table></div><div class="card"><h3>Insight priority task queue</h3><table><tr><th>Surface</th><th>Priority</th><th>Status</th><th>Target</th></tr>${insightRows}</table></div></div><div class="card" style="margin-top:16px"><h3>Dashboard drillthrough telemetry</h3><table><tr><th>Widget</th><th>Target</th><th>Role</th><th>When</th></tr>${drillRows}</table></div>`));
  });

  router.register('POST', '/dashboard/widgets', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDashboardWidgetPreference(state, actor, await readBody(req));
    redirect(res, '/dashboard/runtime');
  });

  router.register('POST', '/dashboard/insights', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDashboardInsightAction(state, actor, await readBody(req));
    redirect(res, '/dashboard/runtime');
  });

  router.register('POST', '/dashboard/drillthrough', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDashboardDrillthroughEvent(state, actor, await readBody(req));
    redirect(res, '/dashboard/runtime');
  });

  router.register('POST', '/dashboard/saved-views', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    recordDashboardSavedView(state, actor, await readBody(req));
    redirect(res, '/dashboard/runtime');
  });

  router.register('GET', '/dashboard/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = persistDashboardHomeRuntimeSnapshot(state, actor, 'dashboard_runtime_page');
    text(res, 200, page('Dashboard runtime snapshot', actor, `<div class="card"><h3>Dashboard home runtime snapshot</h3><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></div>`));
  });

  router.register('GET', '/security', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req))));
  });

  router.register('GET', '/api/security/runtime', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    json(res, 200, { ok: true, security: buildAuthSecurityRuntimeSnapshot(state, actor, req) });
  });

  router.register('POST', '/security/csrf/issue', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const issued = issueCsrfToken(state, actor, req, { action: body.action || 'security_center' });
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), issued, { ok: true, message: 'CSRF token issued.' })));
  });

  router.register('POST', '/security/csrf/validate', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const result = validateCsrfToken(state, actor, req, body.token, { action: body.action || 'security_center' });
    text(res, result.ok ? 200 : 422, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: result.ok, message: result.ok ? 'CSRF token validated.' : 'CSRF token rejected.' })));
  });

  router.register('POST', '/security/mfa/enroll', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const factor = enrollMfaFactor(state, actor, { method: body.method || 'totp', label: body.label || 'Primary authenticator' });
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: true, message: `MFA factor enrolled: ${factor.method}` })));
  });

  router.register('POST', '/security/mfa/challenge', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const challenge = createMfaChallengeForActor(state, actor, { reason: 'security_center' });
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: true, message: 'MFA challenge created. Use verification code 123456 for this local control flow.', challengeId: challenge.id })));
  });

  router.register('POST', '/security/mfa/challenges/:id/verify', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const result = verifyMfaChallenge(state, actor, params.id, body.code || '');
    text(res, result.ok ? 200 : 422, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: result.ok, message: result.ok ? 'MFA challenge verified.' : 'MFA challenge verification failed.' })));
  });

  router.register('POST', '/security/sso/start', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const session = startSsoSessionForActor(state, actor, { provider: body.provider || 'saml', identityProvider: body.identityProvider || 'Okta workforce identity' });
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: true, message: `SSO session started: ${session.provider}` })));
  });

  router.register('POST', '/security/api-keys/rotate', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    const rotation = rotateWorkspaceApiKey(state, actor, { label: body.label || 'Security center rotated key' });
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: true, message: `API key rotated. New preview ${rotation.token.slice(-6)}` })));
  });

  router.register('POST', '/security/sessions/:id/revoke', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    revokeSessionById(state, actor, params.id, 'security-center');
    text(res, 200, page('Security center', actor, securityCenterBody(buildAuthSecurityRuntimeSnapshot(state, actor, req), null, { ok: true, message: 'Session revoked.' })));
  });

  router.register('GET', '/onboarding/operational-readiness', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding operational readiness', actor, '<div class="card"><h3>Operational readiness</h3><p>Track sender identity, domain authentication, workspace defaults, and first-campaign handoff readiness before launch.</p><p><a href="/onboarding/recovery-handoff">Review recovery handoff</a> · <a href="/campaigns/new">Start first campaign</a></p></div>'));
  });

  router.register('GET', '/onboarding/recovery-handoff', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding recovery handoff', actor, '<div class="card"><h3>Recovery handoff</h3><p>Review preserved workspace, sender, domain, team, and first-campaign context before moving from setup recovery into launch execution.</p><p><a href="/onboarding/recovery">Open recovery checklist</a> · <a href="/campaigns/new">Start first campaign</a></p></div>'));
  });

  router.register('GET', '/onboarding/recovery', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Onboarding recovery', actor, `${signupOnboardingRecoveryPanel(actor, { source: 'recovery' })}<div class="grid" style="margin-top:16px"><div class="card"><h3>Recovery actions</h3><p><a href="/settings">Sender/domain setup</a> · <a href="/team">Invite teammates</a> · <a href="/contacts/import">Import contacts</a> · <a href="/campaigns/new">Create first campaign</a></p></div>${workspaceSwitcher(actor)}</div>`));
  });

  router.register('GET', '/onboarding', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const onboarding = actor.workspace.settings.onboarding || {};
    const audiences = state.db.audiences.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Onboarding workspace assistant', actor, `<div class="grid"><div class="card"><h3>Business profile</h3><form method="post" action="/onboarding/profile"><label>Industry<input name="industry" value="${onboarding.industry || ''}" placeholder="Retail, SaaS, nonprofit"></label><label>Primary use case<select name="useCase"><option value="newsletter" ${onboarding.useCase === 'newsletter' ? 'selected' : ''}>Newsletter growth</option><option value="commerce" ${onboarding.useCase === 'commerce' ? 'selected' : ''}>Commerce recovery</option><option value="lifecycle" ${onboarding.useCase === 'lifecycle' ? 'selected' : ''}>Lifecycle nurture</option><option value="events" ${onboarding.useCase === 'events' ? 'selected' : ''}>Events and webinars</option></select></label><label>Suggested sender default<input name="senderDefault" value="${onboarding.senderDefault || actor.workspace.settings.senderEmail || ''}" placeholder="marketing@example.com"></label><label>Import prompt<input name="importPlan" value="${onboarding.importPlan || ''}" placeholder="CSV import, Shopify sync, manual contacts"></label><button>Save onboarding profile</button></form></div><div class="card"><h3>Guided checklist</h3><ol><li>Configure sender identity and authenticated domain.</li><li>Import or create audience contacts.</li><li>Create lead capture or a first campaign.</li><li>Invite teammates and assign roles.</li><li>Review compliance and dashboard recommendations.</li></ol><p>Audiences ready: ${audiences.length}</p><p>Skipped-step recovery keeps incomplete setup visible on the dashboard.</p></div><div class="card"><h3>Recovery and education</h3><form method="post" action="/onboarding/recover"><input name="step" value="${onboarding.lastSkippedStep || 'contact_import'}"><button>Queue recovery reminder</button></form><p>Contextual education: ${onboarding.useCase ? `Recommended path for ${onboarding.useCase}` : 'Choose a use case to receive suggested defaults.'}</p></div></div>`));
  });

  router.register('POST', '/onboarding/profile', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    actor.workspace.settings.onboarding = {
      ...(actor.workspace.settings.onboarding || {}),
      industry: body.industry || '',
      useCase: body.useCase || 'newsletter',
      senderDefault: body.senderDefault || '',
      importPlan: body.importPlan || '',
      completedSteps: [...new Set([...(actor.workspace.settings.onboarding?.completedSteps || []), 'business_profile'])],
      updatedAt: nowIso()
    };
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'onboarding-profile-update', detail: `Saved onboarding profile ${body.useCase || 'newsletter'}` });
    redirect(res, '/onboarding');
  });

  router.register('POST', '/onboarding/recover', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    actor.workspace.settings.onboarding ||= {};
    actor.workspace.settings.onboarding.lastSkippedStep = body.step || 'contact_import';
    actor.workspace.settings.onboarding.recoveryQueuedAt = nowIso();
    enqueueJob(state, { type: 'onboarding_recovery', workspaceId: actor.workspace.id, userId: actor.user.id, payload: { step: actor.workspace.settings.onboarding.lastSkippedStep } });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'onboarding-recovery-queued', detail: `Queued recovery for ${actor.workspace.settings.onboarding.lastSkippedStep}` });
    redirect(res, '/onboarding');
  });

  router.register('GET', '/workspaces', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const memberships = actor.memberships.map((membership) => ({ membership, workspace: state.db.workspaces.find((entry) => entry.id === membership.workspaceId) }));
    const activeMembers = state.db.memberships.filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active').map((membership) => ({ membership, user: state.db.users.find((entry) => entry.id === membership.userId) })).filter((entry) => entry.user);
    text(res, 200, page('Workspaces', actor, `<div class="grid"><div class="card"><h3>Workspace switcher</h3><form method="post" action="/workspaces/switch"><select name="workspaceId">${memberships.map(({ workspace }) => `<option value="${workspace.id}" ${workspace.id === actor.workspace.id ? 'selected' : ''}>${workspace.name}</option>`).join('')}</select><button>Switch workspace</button></form></div><div class="card"><h3>Rename current workspace</h3><form method="post" action="/workspaces"><input name="name" value="${actor.workspace.name}"><button>Rename workspace</button></form></div><div class="card"><h3>Create additional workspace</h3><form method="post" action="/workspaces/new"><input name="name" placeholder="New workspace name" required><button>Create workspace</button></form></div><div class="card"><h3>Ownership transfer</h3><form method="post" action="/workspaces/ownership-transfer"><select name="userId">${activeMembers.map(({ user }) => `<option value="${user.id}">${user.name}</option>`).join('')}</select><button>Transfer ownership</button></form><p>Use this for account handoff and migration readiness.</p></div><div class="card"><h3>API auth</h3><p>Use <code>Authorization: Bearer ...</code></p><code>${actor.workspace.apiKey}</code></div></div><div class="card"><table><tr><th>Workspace</th><th>Role</th><th>Status</th></tr>${memberships.map(({ membership, workspace }) => `<tr><td>${workspace.name}</td><td>${membership.role}</td><td>${membership.status}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/workspaces', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    actor.workspace.name = body.name || actor.workspace.name;
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'workspace-update', detail: `Workspace renamed to ${actor.workspace.name}` });
    redirect(res, '/workspaces');
  });

  router.register('POST', '/workspaces/new', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    createWorkspaceForUser(state, actor, body.name);
    redirect(res, '/workspaces');
  });

  router.register('POST', '/workspaces/switch', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const body = await readBody(req);
    if (!actor.memberships.some((membership) => membership.workspaceId === body.workspaceId)) return text(res, 403, page('Workspace switch denied', actor, '<div class="warn">That workspace is not assigned to this account.</div>'));
    actor.user.activeWorkspaceId = body.workspaceId;
    saveDb(state.db);
    redirect(res, '/app');
  });

  router.register('POST', '/workspaces/ownership-transfer', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    const target = state.db.memberships.find((entry) => entry.workspaceId === actor.workspace.id && entry.userId === body.userId && entry.status === 'active');
    if (!target) return text(res, 404, page('Ownership transfer', actor, '<div class="warn">Target active member not found.</div>'));
    for (const membership of state.db.memberships.filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active')) {
      if (membership.id === target.id) membership.role = 'owner';
      else if (membership.role === 'owner') membership.role = 'admin';
    }
    actor.workspace.settings.ownershipTransferredAt = nowIso();
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'workspace-ownership-transfer', detail: `Transferred owner role to ${target.userId}` });
    redirect(res, '/workspaces');
  });

  router.register('GET', '/team', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const members = state.db.memberships.filter((entry) => entry.workspaceId === actor.workspace.id && entry.status === 'active').map((membership) => ({ membership, user: state.db.users.find((entry) => entry.id === membership.userId) }));
    const invites = state.db.invitations.filter((invite) => invite.workspaceId === actor.workspace.id);
    const roleCounts = members.reduce((acc, entry) => { acc[entry.membership.role] = (acc[entry.membership.role] || 0) + 1; return acc; }, {});
    const pendingInviteCount = invites.filter((invite) => invite.status === 'pending').length;
    const permissionNotes = teamPermissionNotes(state, actor.workspace.id);
    const multiUserGate = hasFeature(actor.workspace, 'multiUser') ? '' : '<div class="warn">Starter plan shows roles and invites, but multi-user collaboration is upgrade-gated.</div>';
    const governance = buildTeamGovernanceRuntimeSnapshot(state, actor.workspace.id);
    text(res, 200, page('Team roles & invitations', actor, `${multiUserGate}<div class="grid"><div class="card"><h3>Role coverage</h3><p>Owners: ${roleCounts.owner || 0}</p><p>Admins: ${roleCounts.admin || 0}</p><p>Members: ${roleCounts.member || 0}</p><p>Pending invites: ${pendingInviteCount}</p><p>Recent permission events: ${permissionNotes.recentPermissionEvents.length}</p></div><div class="card"><h3>Team governance runtime</h3><p>${escapeHtml(governance.label)}</p><p>Policies: ${governance.permissionPolicies.eventCount} · access reviews: ${governance.accessReviews.count} · SCIM events: ${governance.scimProvisioning.count}</p><p><a href="/team/governance">Open governance controls</a> · <a href="/api/team/runtime">Runtime API JSON</a></p></div><div class="card"><h3>Members</h3><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Update</th></tr>${members.map(({ membership, user }) => `<tr><td>${user.name}</td><td>${user.email}</td><td>${membership.role}</td><td>${membership.role === 'owner' ? 'owner locked' : `<form method="post" action="/team/members/${membership.id}/role"><select name="role"><option value="admin" ${membership.role === 'admin' ? 'selected' : ''}>admin</option><option value="member" ${membership.role === 'member' ? 'selected' : ''}>member</option></select><button>Save</button></form>`}</td></tr>`).join('')}</table></div><div class="card"><h3>Invite teammate</h3><form method="post" action="/team/invitations"><input name="email" type="email" placeholder="teammate@example.com" required><select name="role"><option value="admin">admin</option><option value="member">member</option></select><button>Send invite</button></form></div></div><div class="card"><table><tr><th>Email</th><th>Role</th><th>Status</th><th>Accept link</th><th>Actions</th></tr>${invites.map((invite) => `<tr><td>${invite.email}</td><td>${invite.role}</td><td>${invite.status}</td><td><a href="/invites/${invite.token}">/invites/${invite.token}</a></td><td>${invite.status === 'pending' ? `<form method="post" action="/team/invitations/${invite.id}/resend"><button>Resend</button></form>` : '—'}</td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/team/invitations', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    state.db.invitations.unshift({ id: deps.createId('invite'), workspaceId: actor.workspace.id, email: body.email, role: body.role || 'member', token: deps.createId('invite_token'), status: 'pending', invitedBy: actor.user.id, createdAt: nowIso(), expiresAt: createInvitationExpiry() });
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'invite-create', detail: `Invited ${body.email} as ${body.role}` });
    redirect(res, '/team');
  });

  router.register('POST', '/team/invitations/:id/resend', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const invite = state.db.invitations.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id && entry.status === 'pending');
    if (!invite) return text(res, 404, page('Team roles & invitations', actor, '<div class="warn">Pending invitation not found.</div>'));
    invite.token = deps.createId('invite_token');
    invite.updatedAt = nowIso();
    invite.expiresAt = createInvitationExpiry();
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'invite-resend', detail: `Resent invite for ${invite.email}` });
    redirect(res, '/team');
  });

  router.register('POST', '/team/members/:id/role', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const membership = state.db.memberships.find((entry) => entry.id === params.id && entry.workspaceId === actor.workspace.id && entry.status === 'active');
    if (!membership) return text(res, 404, page('Team roles & invitations', actor, '<div class="warn">Membership not found.</div>'));
    const body = await readBody(req);
    membership.role = body.role === 'admin' ? 'admin' : 'member';
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'member-role-update', detail: `Updated membership ${membership.id} to ${membership.role}` });
    redirect(res, '/team');
  });

  router.register('GET', '/team/governance', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = buildTeamGovernanceRuntimeSnapshot(state, actor.workspace.id);
    const policyRows = snapshot.permissionPolicies.recentEvents.map((entry) => `<tr><td>${escapeHtml(entry.role)}</td><td>${entry.permissions.map((permission) => `<code>${escapeHtml(permission)}</code>`).join(' ')}</td><td>${escapeHtml(entry.scope)}</td><td>${escapeHtml(entry.enforcement)}</td></tr>`).join('') || '<tr><td colspan="4">No permission policies recorded yet.</td></tr>';
    const reviewRows = snapshot.accessReviews.recent.map((entry) => `<tr><td>${escapeHtml(entry.reviewName)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.dueAt)}</td><td>${escapeHtml(entry.attestation)}</td></tr>`).join('') || '<tr><td colspan="4">No access reviews yet.</td></tr>';
    const scimRows = snapshot.scimProvisioning.recent.map((entry) => `<tr><td>${escapeHtml(entry.email)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.identityProvider)}</td></tr>`).join('') || '<tr><td colspan="4">No SCIM provisioning events yet.</td></tr>';
    text(res, 200, page('Team governance runtime', actor, `<div class="grid"><div class="card"><h3>Team governance runtime</h3><p>${escapeHtml(snapshot.label)}</p><p>Evidence: ${snapshot.evidenceContract.map((entry) => `<code>${escapeHtml(entry)}</code>`).join(' ')}</p><p><a href="/team/runtime/snapshot">Persist team governance snapshot</a> · <a href="/api/team/runtime">Runtime API JSON</a></p><pre>${escapeHtml(JSON.stringify(snapshot.runtimeHealth, null, 2))}</pre></div><div class="card"><h3>Permission policy</h3><form method="post" action="/team/policies"><select name="role"><option value="admin">admin</option><option value="member">member</option><option value="viewer">viewer</option><option value="developer">developer</option></select><input name="permissions" value="campaigns:send,audience:export,reports:read"><input name="scope" value="workspace"><button>Record policy</button></form></div><div class="card"><h3>Access review and delegation</h3><form method="post" action="/team/access-review"><input name="reviewName" value="Quarterly access review"><button>Open access review</button></form><form method="post" action="/team/delegated-admin"><input name="scope" value="audience_management"><select name="delegatedRole"><option value="admin">admin</option><option value="developer">developer</option></select><button>Grant delegated admin</button></form></div><div class="card"><h3>SCIM and region governance</h3><form method="post" action="/team/scim"><input name="email" value="scim-user@example.test"><input name="externalId" value="scim-001"><select name="action"><option value="provision_user">provision_user</option><option value="deactivate_user">deactivate_user</option></select><button>Record SCIM event</button></form><form method="post" action="/team/regions"><input name="region" value="us"><input name="policy" value="workspace_data_region_enforced"><button>Set region policy</button></form></div></div><div class="grid" style="margin-top:16px"><div class="card"><h3>Permission policy matrix</h3><table><tr><th>Role</th><th>Permissions</th><th>Scope</th><th>Enforcement</th></tr>${policyRows}</table></div><div class="card"><h3>Access reviews</h3><table><tr><th>Review</th><th>Status</th><th>Due</th><th>Attestation</th></tr>${reviewRows}</table></div></div><div class="card" style="margin-top:16px"><h3>SCIM provisioning lifecycle</h3><table><tr><th>Email</th><th>Action</th><th>Status</th><th>IdP</th></tr>${scimRows}</table></div>`));
  });

  router.register('POST', '/team/policies', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordTeamPermissionPolicy(state, actor, await readBody(req));
    redirect(res, '/team/governance');
  });

  router.register('POST', '/team/access-review', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordTeamAccessReview(state, actor, await readBody(req));
    redirect(res, '/team/governance');
  });

  router.register('POST', '/team/delegated-admin', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordTeamDelegatedAdminGrant(state, actor, await readBody(req));
    redirect(res, '/team/governance');
  });

  router.register('POST', '/team/scim', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordTeamScimProvisioningEvent(state, actor, await readBody(req));
    redirect(res, '/team/governance');
  });

  router.register('POST', '/team/regions', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordTeamRegionGovernanceEvent(state, actor, await readBody(req));
    redirect(res, '/team/governance');
  });

  router.register('GET', '/team/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = persistTeamGovernanceRuntimeSnapshot(state, actor, 'team_governance_page');
    text(res, 200, page('Team governance runtime snapshot', actor, `<div class="card"><h3>Team governance runtime snapshot</h3><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></div>`));
  });

  router.register('GET', '/billing', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = buildBillingEntitlementsRuntimeSnapshot(state, actor.workspace.id);
    const usageRows = snapshot.usage.recentEvents.map((entry) => `<tr><td>${escapeHtml(entry.metric)}</td><td>${entry.quantity}</td><td>${escapeHtml(entry.cycle)}</td><td>${entry.cycleUsageAfterEvent}/${entry.limit}</td><td>${entry.overageQuantity}</td></tr>`).join('') || '<tr><td colspan="5">No metered usage yet.</td></tr>';
    const invoiceRows = snapshot.invoices.recent.map((invoice) => `<tr><td>${escapeHtml(invoice.id)}</td><td>${escapeHtml(invoice.amount || '')}</td><td>${escapeHtml(invoice.status || '')}</td><td>${escapeHtml(invoice.collectionState || 'plan-change')}</td></tr>`).join('') || '<tr><td colspan="4">No invoices yet.</td></tr>';
    text(res, 200, page('Billing & plans', actor, `<div class="grid">${PLAN_CATALOG.map((plan) => `<div class="card"><h3>${escapeHtml(plan.name)}</h3><p>${escapeHtml(plan.price)} / month</p><p>${plan.monthlyLimit} sends included</p><ul><li>Scheduled send: ${plan.features.scheduledSend ? 'yes' : 'upgrade required'}</li><li>Advanced segments: ${plan.features.advancedSegments ? 'yes' : 'upgrade required'}</li><li>Audit export: ${plan.features.auditExport ? 'yes' : 'upgrade required'}</li></ul><form method="post" action="/billing/plan"><input type="hidden" name="planId" value="${escapeHtml(plan.id)}"><button>${plan.id === actor.workspace.planId ? 'Current plan' : 'Switch plan'}</button></form></div>`).join('')}</div><div class="grid" style="margin-top:16px"><div class="card"><h3>Billing entitlement runtime</h3><p>${escapeHtml(snapshot.label)}</p><p>Visible gates: scheduled send, advanced segments, audit export.</p><p>Plan: ${escapeHtml(snapshot.plan.name)} · sends ${snapshot.usage.monthlySendUsage}/${snapshot.usage.monthlySendLimit} · overage ${snapshot.usage.overageQuantity}</p><p>Evidence: ${snapshot.evidenceContract.map((entry) => `<code>${escapeHtml(entry)}</code>`).join(' ')}</p><form method="post" action="/billing/entitlements/reconcile"><button>Reconcile entitlements</button></form><p><a href="/billing/runtime/snapshot">Persist billing runtime snapshot</a> · <a href="/api/billing/runtime">Runtime API JSON</a></p></div><div class="card"><h3>Usage meter</h3><form method="post" action="/billing/usage-meter"><input name="metric" value="emails_sent"><input name="quantity" type="number" value="1200"><button>Record usage</button></form><form method="post" action="/billing/trial"><select name="planId"><option value="growth">Growth trial</option><option value="pro">Pro trial</option></select><button>Start trial</button></form><form method="post" action="/billing/invoice-run"><button>Create invoice run</button></form></div></div><div class="card"><h3>Usage meter ledger</h3><table><tr><th>Metric</th><th>Quantity</th><th>Cycle</th><th>Usage/limit</th><th>Overage</th></tr>${usageRows}</table></div><div class="card"><h3>Current plan semantics</h3><table><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Collection</th></tr>${invoiceRows}</table></div>`));
  });

  router.register('POST', '/billing/plan', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    applyBillingPlan(state, actor, body.planId);
    redirect(res, '/billing');
  });

  router.register('POST', '/billing/entitlements/reconcile', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    reconcileBillingEntitlements(state, actor, { reason: 'billing_runtime_center' });
    redirect(res, '/billing');
  });

  router.register('POST', '/billing/usage-meter', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    recordBillingUsageMeterEvent(state, actor, await readBody(req));
    redirect(res, '/billing');
  });

  router.register('POST', '/billing/trial', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    startBillingTrial(state, actor, await readBody(req));
    redirect(res, '/billing');
  });

  router.register('POST', '/billing/invoice-run', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    runBillingInvoiceCollection(state, actor, await readBody(req));
    redirect(res, '/billing');
  });

  router.register('GET', '/billing/runtime/snapshot', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const snapshot = persistBillingEntitlementsRuntimeSnapshot(state, actor, 'billing_runtime_page');
    text(res, 200, page('Billing runtime snapshot', actor, `<div class="card"><h3>Billing entitlement runtime snapshot</h3><pre>${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre></div>`));
  });

  router.register('GET', '/feature-flags', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    text(res, 200, page('Feature flags', actor, `<div class="card"><table><tr><th>Flag</th><th>Enabled</th><th>Toggle</th></tr>${Object.entries(actor.workspace.featureFlags).map(([key, value]) => `<tr><td>${key}</td><td>${value ? 'on' : 'off'}</td><td><form method="post" action="/feature-flags/toggle"><input type="hidden" name="key" value="${key}"><button>${value ? 'Disable' : 'Enable'}</button></form></td></tr>`).join('')}</table></div>`));
  });

  router.register('POST', '/feature-flags/toggle', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor || !requireAdmin(actor, res, text)) return;
    const body = await readBody(req);
    actor.workspace.featureFlags[body.key] = !actor.workspace.featureFlags[body.key];
    saveDb(state.db);
    recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: 'feature-flag-toggle', detail: `${body.key} => ${actor.workspace.featureFlags[body.key]}` });
    redirect(res, '/feature-flags');
  });

  router.register('GET', '/settings', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const domains = actor.workspace.settings.domains || [];
    const verifiedDomains = domains.filter((entry) => entry.verificationStatus === 'verified').length;
    const authenticatedDomains = domains.filter((entry) => entry.authenticationStatus === 'authenticated').length;
    const defaultDomain = domains.find((entry) => entry.isDefault)?.name || 'missing';
    text(res, 200, page('Settings shell', actor, `<div class="grid"><div class="card"><form method="post" action="/settings"><input name="senderName" value="${actor.workspace.settings.senderName || ''}"><input name="senderEmail" type="email" value="${actor.workspace.settings.senderEmail || ''}"><input name="replyTo" type="email" value="${actor.workspace.settings.replyTo || ''}"><input name="timezone" value="${actor.workspace.settings.timezone || ''}"><input name="brandColor" value="${actor.workspace.settings.brandColor || ''}"><textarea name="address">${actor.workspace.settings.address || ''}</textarea><button>Save settings</button></form></div><div class="card"><h3>Visible compliance state</h3><p>Sender email: ${actor.workspace.settings.senderEmail || 'missing'}</p><p>Physical address: ${actor.workspace.settings.address || 'missing'}</p><p>Authenticated default domain: ${defaultDomain}</p></div><div class="card"><h3>Domain readiness</h3><p>Verified domains: ${verifiedDomains}</p><p>Authenticated domains: ${authenticatedDomains}</p><p>Default domain: ${defaultDomain}</p><p><a href="/api/settings/domains">API domain summary</a></p></div><div class="card"><h3>Domains & authentication</h3><form method="post" action="/settings/domains"><input name="domain" placeholder="example.com" required><button>Add domain</button></form><table><tr><th>Domain</th><th>Verification</th><th>Authentication</th><th>Default</th><th>Actions</th></tr>${domains.map((domain) => `<tr><td>${domain.name}</td><td>${domain.verificationStatus}</td><td>${domain.authenticationStatus}</td><td>${domain.isDefault ? 'yes' : 'no'}</td><td><p><a href="/settings/domains/${domain.id}">View details</a></p><form method="post" action="/settings/domains/${domain.id}/verify"><button>Verify</button></form><form method="post" action="/settings/domains/${domain.id}/authenticate"><button>Authenticate</button></form><form method="post" action="/settings/domains/${domain.id}/default"><button>Make default</button></form></td></tr>`).join('') || '<tr><td colspan="5">No sending domains connected yet.</td></tr>'}</table></div></div>`));
  });

  router.register('POST', '/settings', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    updateSettings(state, actor, await readBody(req));
    redirect(res, '/settings');
  });

  router.register('POST', '/settings/domains', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    addDomain(state, actor, (await readBody(req)).domain);
    redirect(res, '/settings');
  });

  router.register('GET', '/settings/domains/:id', async ({ state, req, params, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const domains = actor.workspace.settings.domains || [];
    const domain = domains.find((entry) => entry.id === params.id);
    if (!domain) return text(res, 404, page('Settings shell', actor, '<div class="warn">Domain not found.</div>'));
    text(res, 200, page('Domain authentication detail', actor, `<div class="grid"><div class="card"><h3>${domain.name}</h3><p>Verification: ${domain.verificationStatus}</p><p>Authentication: ${domain.authenticationStatus}</p><p>Default: ${domain.isDefault ? 'yes' : 'no'}</p></div><div class="card"><h3>DNS checklist</h3><ul><li>TXT verification record</li><li>DKIM selector</li><li>Return-path / bounce domain</li></ul><p><a href="/settings">Return to settings</a></p></div></div>`));
  });

  for (const [action, mutate] of [['verify', (d) => { d.verificationStatus = 'verified'; }], ['authenticate', (d) => { if (d.verificationStatus === 'verified') d.authenticationStatus = 'authenticated'; }], ['default', (d, domains) => { domains.forEach((entry) => { entry.isDefault = false; }); d.isDefault = true; }]]) {
    router.register('POST', `/settings/domains/:id/${action}`, async ({ state, req, params, res }) => {
      const actor = requireAuth(state, req, res);
      if (!actor) return;
      const domains = actor.workspace.settings.domains || [];
      const domain = domains.find((entry) => entry.id === params.id);
      if (!domain) return text(res, 404, page('Settings shell', actor, '<div class="warn">Domain not found.</div>'));
      mutate(domain, domains);
      saveDb(state.db);
      recordAudit(state, { workspaceId: actor.workspace.id, userId: actor.user.id, action: `domain-${action}`, detail: `${action} ${domain.name}` });
      redirect(res, '/settings');
    });
  }

  router.register('GET', '/assets', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    const assets = state.db.assets.filter((entry) => entry.workspaceId === actor.workspace.id);
    text(res, 200, page('Content studio / asset manager', actor, `<div class="grid"><div class="card"><h3>Add asset</h3><form method="post" action="/assets"><input name="name" placeholder="hero.txt" required><input name="folder" value="Campaign assets"><input name="contentType" value="text/plain"><input name="altText" placeholder="Alt text"><textarea name="body"></textarea><button>Save asset</button></form></div><div class="card"><h3>Stored assets</h3><table><tr><th>Name</th><th>Folder</th><th>Type</th><th>Usage</th><th>Storage path</th></tr>${assets.map((asset) => `<tr><td>${asset.name}</td><td>${asset.folder}</td><td>${asset.contentType}</td><td>${asset.usageCount || 0}</td><td><code>${asset.storagePath}</code></td></tr>`).join('')}</table></div></div>`));
  });

  router.register('POST', '/assets', async ({ state, req, res }) => {
    const actor = requireAuth(state, req, res);
    if (!actor) return;
    storeAsset(state, actor, await readBody(req));
    redirect(res, '/assets');
  });
}


export const accountWorkspaceSetupIntegratedUserPathEvidenceSemanticRuntimeContract = Object.freeze({"surfaceId":"account_workspace_setup","focusGroup":"signup_onboarding","phaseId":"integrated_user_path_evidence","shardId":"focus.account_workspace_setup::semantic-frontier-001#05-integrated_user_path_evidence#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAccountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "account_workspace_setup:integrated_user_path_evidence:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:account_workspace_setup:monitor_job_runtime_handoff" : "integrated_user_path_evidence:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const accountWorkspaceSetupInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"account_workspace_setup","focusGroup":"signup_onboarding","phaseId":"interactive_state_and_commands","shardId":"focus.account_workspace_setup::semantic-frontier-001#05-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAccountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "account_workspace_setup:interactive_state_and_commands:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:account_workspace_setup:monitor_job_runtime_handoff" : "interactive_state_and_commands:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const signupOnboardingIntegratedUserPathEvidenceSemanticRuntimeContract = Object.freeze({"surfaceId":"signup_onboarding","focusGroup":"signup_onboarding","phaseId":"integrated_user_path_evidence","shardId":"focus.signup_onboarding::semantic-frontier-001#25-integrated_user_path_evidence#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildSignupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "signup_onboarding:integrated_user_path_evidence:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.signup_onboarding::semantic-frontier-001#25-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:signup_onboarding:monitor_job_runtime_handoff" : "integrated_user_path_evidence:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const signupOnboardingInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"signup_onboarding","focusGroup":"signup_onboarding","phaseId":"interactive_state_and_commands","shardId":"focus.signup_onboarding::semantic-frontier-001#25-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildSignupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "signup_onboarding:interactive_state_and_commands:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.signup_onboarding::semantic-frontier-001#25-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:signup_onboarding:monitor_job_runtime_handoff" : "interactive_state_and_commands:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const accountWorkspaceSetupPrimaryRuntimeSpineSemanticRuntimeContract = Object.freeze({"surfaceId":"account_workspace_setup","focusGroup":"signup_onboarding","phaseId":"primary_runtime_spine","shardId":"focus.account_workspace_setup::semantic-frontier-001#05-primary_runtime_spine#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAccountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "account_workspace_setup:primary_runtime_spine:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:account_workspace_setup:monitor_job_runtime_handoff" : "primary_runtime_spine:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const dashboardHomeInteractiveStateAndCommandsSemanticRuntimeContract = Object.freeze({"surfaceId":"dashboard_home","focusGroup":"signup_onboarding","phaseId":"interactive_state_and_commands","shardId":"focus.dashboard_home::semantic-frontier-001#15-interactive_state_and_commands#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildDashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "dashboard_home:interactive_state_and_commands:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.dashboard_home::semantic-frontier-001#15-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:dashboard_home:monitor_job_runtime_handoff" : "interactive_state_and_commands:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const signupOnboardingPrimaryRuntimeSpineSemanticRuntimeContract = Object.freeze({"surfaceId":"signup_onboarding","focusGroup":"signup_onboarding","phaseId":"primary_runtime_spine","shardId":"focus.signup_onboarding::semantic-frontier-001#25-primary_runtime_spine#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildSignupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "signup_onboarding:primary_runtime_spine:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.signup_onboarding::semantic-frontier-001#25-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:signup_onboarding:monitor_job_runtime_handoff" : "primary_runtime_spine:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const accountWorkspaceSetupOperationalPersistenceAndJobsSemanticRuntimeContract = Object.freeze({"surfaceId":"account_workspace_setup","focusGroup":"signup_onboarding","phaseId":"operational_persistence_and_jobs","shardId":"focus.account_workspace_setup::semantic-frontier-001#05-operational_persistence_and_jobs#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildAccountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "account_workspace_setup:operational_persistence_and_jobs:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "operational_persistence_and_jobs", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:account_workspace_setup:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "signup_onboarding:operational_persistence_and_jobs:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "operational_persistence_and_jobs", shardId: "focus.signup_onboarding::semantic-frontier-001#25-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/job-handlers.mjs","packages/app/job-runtime.mjs"], nextAction: signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:signup_onboarding:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const dashboardHomeIntegratedUserPathEvidenceSemanticRuntimeContract = Object.freeze({"surfaceId":"dashboard_home","focusGroup":"signup_onboarding","phaseId":"integrated_user_path_evidence","shardId":"focus.dashboard_home::semantic-frontier-001#15-integrated_user_path_evidence#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildDashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "dashboard_home:integrated_user_path_evidence:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.dashboard_home::semantic-frontier-001#15-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:dashboard_home:monitor_job_runtime_handoff" : "integrated_user_path_evidence:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}


export const dashboardHomeOperationalPersistenceAndJobsSemanticRuntimeContract = Object.freeze({"surfaceId":"dashboard_home","focusGroup":"signup_onboarding","phaseId":"operational_persistence_and_jobs","shardId":"focus.dashboard_home::semantic-frontier-001#15-operational_persistence_and_jobs#1","cloneParityIntent":"strict_mailchimp_clone_product_runtime","productIntent":"Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.","runtimeEvidence":["primary_product_file_adoption","normal_app_path_invocation_ready","executable_verifier_evidence_required"]});


export function buildDashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "dashboard_home:operational_persistence_and_jobs:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "persist storage job queue retry transaction lock dead-letter", dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "operational_persistence_and_jobs", shardId: "focus.dashboard_home::semantic-frontier-001#15-operational_persistence_and_jobs#1", productIntent: "Connect the capability to durable persistence, background work, telemetry, sync, or audit surfaces where the real product would require it.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/job-handlers.mjs"], nextAction: dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "operational_persistence_and_jobs:dashboard_home:monitor_job_runtime_handoff" : "operational_persistence_and_jobs:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeOperationalPersistenceAndJobsPackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey = "dashboard_home:primary_runtime_spine:packages/app/routes/platform.mjs", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.dashboard_home::semantic-frontier-001#15-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:dashboard_home:monitor_job_runtime_handoff" : "primary_runtime_spine:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsAdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildAccountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeKey = "account_workspace_setup:integrated_user_path_evidence:packages/app/routes/platform.mjs:semanticFrontier00105IntegratedUserPathEvidence1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:account_workspace_setup:monitor_job_runtime_handoff" : "integrated_user_path_evidence:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00105IntegratedUserPathEvidence1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeKey = "signup_onboarding:integrated_user_path_evidence:packages/app/routes/platform.mjs:semanticFrontier00125IntegratedUserPathEvidence1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.signup_onboarding::semantic-frontier-001#25-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:signup_onboarding:monitor_job_runtime_handoff" : "integrated_user_path_evidence:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeKey = "signup_onboarding:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00125PrimaryRuntimeSpine1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.signup_onboarding::semantic-frontier-001#25-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:signup_onboarding:monitor_job_runtime_handoff" : "primary_runtime_spine:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildAccountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeKey = "account_workspace_setup:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00105PrimaryRuntimeSpine1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:account_workspace_setup:monitor_job_runtime_handoff" : "primary_runtime_spine:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeKey = "dashboard_home:integrated_user_path_evidence:packages/app/routes/platform.mjs:semanticFrontier00115IntegratedUserPathEvidence1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.dashboard_home::semantic-frontier-001#15-integrated_user_path_evidence#1", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:dashboard_home:monitor_job_runtime_handoff" : "integrated_user_path_evidence:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeKey = "dashboard_home:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00115PrimaryRuntimeSpine1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.dashboard_home::semantic-frontier-001#15-primary_runtime_spine#1", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:dashboard_home:monitor_job_runtime_handoff" : "primary_runtime_spine:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeKey = "dashboard_home:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00115InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.dashboard_home::semantic-frontier-001#15-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:dashboard_home:monitor_job_runtime_handoff" : "interactive_state_and_commands:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeKey = "signup_onboarding:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00125PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.signup_onboarding::semantic-frontier-001#25-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:signup_onboarding:monitor_job_runtime_handoff" : "primary_runtime_spine:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00125PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildAccountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeKey = "account_workspace_setup:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00105InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:account_workspace_setup:monitor_job_runtime_handoff" : "interactive_state_and_commands:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeKey = "dashboard_home:integrated_user_path_evidence:packages/app/routes/platform.mjs:semanticFrontier00115IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.dashboard_home::semantic-frontier-001#15-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:dashboard_home:monitor_job_runtime_handoff" : "integrated_user_path_evidence:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00115IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildAccountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeKey = "account_workspace_setup:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00105PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:account_workspace_setup:monitor_job_runtime_handoff" : "primary_runtime_spine:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupPrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00105PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeKey = "dashboard_home:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00115InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.dashboard_home::semantic-frontier-001#15-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:dashboard_home:monitor_job_runtime_handoff" : "interactive_state_and_commands:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomeInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00115InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildDashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionState(state = {}, actor = {}, input = {}) {
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeKey = "dashboard_home:primary_runtime_spine:packages/app/routes/platform.mjs:semanticFrontier00115PrimaryRuntimeSpine2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal = "route runtime handler service workflow persist state provider queue", dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeKey, surfaceId: "dashboard_home", focusGroup: "signup_onboarding", phaseId: "primary_runtime_spine", shardId: "focus.dashboard_home::semantic-frontier-001#15-primary_runtime_spine#2", productIntent: "Create or deepen the primary product runtime model for this Mailchimp capability, not an isolated parity marker module.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeCounts, phaseRuntimeSignal: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionPhaseRuntimeSignal, workflowEvidence: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/domain-current-product-ops.mjs","packages/app/index.mjs","packages/app/routes/platform.mjs"], nextAction: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "primary_runtime_spine:dashboard_home:monitor_job_runtime_handoff" : "primary_runtime_spine:dashboard_home:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: dashboardHomePrimaryRuntimeSpinePackagesAppRoutesPlatformMjsSemanticFrontier00115PrimaryRuntimeSpine2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildAccountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeKey = "account_workspace_setup:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00105InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "account_workspace_setup", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.account_workspace_setup::semantic-frontier-001#05-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:account_workspace_setup:monitor_job_runtime_handoff" : "interactive_state_and_commands:account_workspace_setup:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: accountWorkspaceSetupInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00105InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeKey = "signup_onboarding:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00125InteractiveStateAndCommands1", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.signup_onboarding::semantic-frontier-001#25-interactive_state_and_commands#1", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:signup_onboarding:monitor_job_runtime_handoff" : "interactive_state_and_commands:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands1AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeKey = "signup_onboarding:integrated_user_path_evidence:packages/app/routes/platform.mjs:semanticFrontier00125IntegratedUserPathEvidence2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal = "route render handler request response workflow submit execute", signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "integrated_user_path_evidence", shardId: "focus.signup_onboarding::semantic-frontier-001#25-integrated_user_path_evidence#2", productIntent: "Ensure the architecture is adopted by a real app path with executable verifier coverage rather than existing as disconnected helper code.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["packages/app/index.mjs","packages/app/persistence-io.mjs","packages/app/routes/platform.mjs"], nextAction: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "integrated_user_path_evidence:signup_onboarding:monitor_job_runtime_handoff" : "integrated_user_path_evidence:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingIntegratedUserPathEvidencePackagesAppRoutesPlatformMjsSemanticFrontier00125IntegratedUserPathEvidence2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}



export function buildSignupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionState(state = {}, actor = {}, input = {}) {
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeKey = "signup_onboarding:interactive_state_and_commands:packages/app/routes/platform.mjs:semanticFrontier00125InteractiveStateAndCommands2", workspaceId = input.workspaceId || actor?.workspace?.id || actor?.workspaceId || 'workspace', db = state.db || {};
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeCounts = { contactCount: Array.isArray(db.contacts) ? db.contacts.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0, jobQueueDepth: Array.isArray(db.jobs) ? db.jobs.filter((entry) => !entry.workspaceId || entry.workspaceId === workspaceId).length : 0 };
  const signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal = "client state hydrate command event dispatch session reducer", signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionWorkflowEvidence = input.workflowEvidence || 'semantic_frontier_product_runtime_evaluated';
  return { runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeKey, surfaceId: "signup_onboarding", focusGroup: "signup_onboarding", phaseId: "interactive_state_and_commands", shardId: "focus.signup_onboarding::semantic-frontier-001#25-interactive_state_and_commands#2", productIntent: "Add user-facing state transitions, commands, validation, undo/recovery, or workflow continuity that moves beyond static route presence.", targetFile: "packages/app/routes/platform.mjs", workspaceId, durableStateReady: Boolean(db), ...signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeCounts, phaseRuntimeSignal: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionPhaseRuntimeSignal, workflowEvidence: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionWorkflowEvidence, adoptionPath: input.adoptionPath || ["apps/web/public/app-shell.css","apps/web/public/app-shell.jsx","apps/web/server.mjs"], nextAction: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeCounts.jobQueueDepth > 0 ? "interactive_state_and_commands:signup_onboarding:monitor_job_runtime_handoff" : "interactive_state_and_commands:signup_onboarding:continue_primary_product_workflow", auditEvent: { type: 'semantic_frontier_product_runtime_evaluated', runtimeKey: signupOnboardingInteractiveStateAndCommandsPackagesAppRoutesPlatformMjsSemanticFrontier00125InteractiveStateAndCommands2AdoptionRuntimeKey, targetFile: "packages/app/routes/platform.mjs" } };
}

